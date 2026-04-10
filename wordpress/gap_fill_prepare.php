<?php
/**
 * Gap Fill 前処理API（DB直接アクセス）
 *
 * 指定された記事群のコンテンツを取得し、
 * H2見出し抽出 + 既存CTA検出 + セクション要約をまとめてJSONで返す。
 *
 * GAS/Node.js の Gap Fill パイプラインから呼ばれる。
 * 記事コンテンツの取得と構造解析をPHP側で一括処理することで、
 * REST API のページネーション（~60秒）を ~1秒に短縮。
 *
 * Usage:
 *   gap_fill_prepare.php?token=SECRET&post_ids=5286,18924,6504
 *   gap_fill_prepare.php?token=SECRET&category=securities&limit=50&offset=0
 *
 * Parameters:
 *   token     (必須) セキュリティトークン
 *   post_ids  (任意) 対象記事IDのカンマ区切り
 *   category  (任意) カテゴリスラッグでフィルタ
 *   limit     (任意) 取得件数上限（デフォルト: 50）
 *   offset    (任意) オフセット（デフォルト: 0）
 *   pv_min    (任意) 最低PV（impressions）閾値。これ以下の記事はスキップ
 *
 * Response:
 *   {
 *     "generated_at": "2026-04-10 14:00:00",
 *     "total": 3,
 *     "posts": [
 *       {
 *         "id": 5286,
 *         "url": "https://...",
 *         "title": "新NISA...",
 *         "category": "securities",
 *         "sections": [
 *           {"index": 1, "heading": "新NISAは子供名義で？", "hasCta": false, "excerpt": "新NISAは18歳以上が..."},
 *           {"index": 2, "heading": "親名義で準備", "hasCta": true, "excerpt": ""},
 *           ...
 *         ]
 *       }
 *     ]
 *   }
 */

header('Content-Type: application/json; charset=utf-8');

define('SECRET_TOKEN', 'ta_placement_8f3k2m9x7v1q4w6e');

if (!isset($_GET['token']) || $_GET['token'] !== SECRET_TOKEN) {
    http_response_code(403);
    die(json_encode(['error' => 'Forbidden'], JSON_UNESCAPED_UNICODE));
}

set_time_limit(60);

// ============================================================
// DB接続
// ============================================================
$wpConfigPath = __DIR__ . '/wp-config.php';
if (!file_exists($wpConfigPath)) {
    http_response_code(500);
    die(json_encode(['error' => 'wp-config.php not found'], JSON_UNESCAPED_UNICODE));
}

$wpConfig = file_get_contents($wpConfigPath);
preg_match("/define\(\s*'DB_NAME'\s*,\s*'([^']+)'/", $wpConfig, $m);
$dbName = $m[1];
preg_match("/define\(\s*'DB_USER'\s*,\s*'([^']+)'/", $wpConfig, $m);
$dbUser = $m[1];
preg_match("/define\(\s*'DB_PASSWORD'\s*,\s*'([^']+)'/", $wpConfig, $m);
$dbPass = $m[1];
preg_match("/define\(\s*'DB_HOST'\s*,\s*'([^']+)'/", $wpConfig, $m);
$dbHost = $m[1];
preg_match('/\$table_prefix\s*=\s*\'([^\']+)\'/', $wpConfig, $m);
$prefix = isset($m[1]) ? $m[1] : 'wp_';

$db = new mysqli($dbHost, $dbUser, $dbPass, $dbName);
$db->set_charset('utf8mb4');

if ($db->connect_error) {
    http_response_code(500);
    die(json_encode(['error' => 'DB connection failed'], JSON_UNESCAPED_UNICODE));
}

// ============================================================
// URL構築用の準備
// ============================================================
$optResult = $db->query(
    "SELECT option_value FROM {$prefix}options WHERE option_name = 'home' LIMIT 1"
);
$siteUrl = rtrim($optResult->fetch_assoc()['option_value'], '/');

$postsPagePrefix = '';
$ppResult = $db->query(
    "SELECT p.post_name FROM {$prefix}options o
     JOIN {$prefix}posts p ON o.option_value = p.ID
     WHERE o.option_name = 'page_for_posts' AND o.option_value > 0 LIMIT 1"
);
if ($ppRow = $ppResult->fetch_assoc()) {
    $postsPagePrefix = $ppRow['post_name'];
}

// カテゴリ階層
$termSlugs = [];
$termParents = [];
$sql = "SELECT t.term_id, t.slug, tt.parent
        FROM {$prefix}terms t
        JOIN {$prefix}term_taxonomy tt ON t.term_id = tt.term_id
        WHERE tt.taxonomy = 'category'";
$termResult = $db->query($sql);
while ($row = $termResult->fetch_assoc()) {
    $tid = (int)$row['term_id'];
    $termSlugs[$tid] = $row['slug'];
    $termParents[$tid] = (int)$row['parent'];
}
$termResult->free();

// 記事→カテゴリ
$postTermIds = [];
$sql = "SELECT tr.object_id AS post_id, tt.term_id
        FROM {$prefix}term_relationships tr
        JOIN {$prefix}term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
        WHERE tt.taxonomy = 'category'";
$catResult = $db->query($sql);
while ($row = $catResult->fetch_assoc()) {
    $postTermIds[$row['post_id']][] = (int)$row['term_id'];
}
$catResult->free();

// ============================================================
// パラメータ解析
// ============================================================
$limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 50;
$offset = isset($_GET['offset']) ? (int)$_GET['offset'] : 0;
$categoryFilter = isset($_GET['category']) ? $_GET['category'] : null;

// post_ids指定時
$postIdFilter = null;
if (isset($_GET['post_ids']) && $_GET['post_ids'] !== '') {
    $postIdFilter = array_map('intval', explode(',', $_GET['post_ids']));
}

// ============================================================
// 記事取得
// ============================================================
if ($postIdFilter) {
    $idList = implode(',', $postIdFilter);
    $sql = "SELECT ID, post_title, post_name, post_content
            FROM {$prefix}posts
            WHERE ID IN ({$idList}) AND post_type = 'post' AND post_status = 'publish'
            ORDER BY ID ASC";
} else {
    // カテゴリフィルタ
    $categoryJoin = '';
    $categoryWhere = '';
    if ($categoryFilter) {
        $filterTermId = null;
        foreach ($termSlugs as $tid => $slug) {
            if ($slug === $categoryFilter) {
                $filterTermId = $tid;
                break;
            }
        }
        if ($filterTermId) {
            $categoryJoin = "JOIN {$prefix}term_relationships tr ON p.ID = tr.object_id
                             JOIN {$prefix}term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id";
            $categoryWhere = "AND tt.term_id = {$filterTermId} AND tt.taxonomy = 'category'";
        }
    }

    $sql = "SELECT p.ID, p.post_title, p.post_name, p.post_content
            FROM {$prefix}posts p
            {$categoryJoin}
            WHERE p.post_type = 'post' AND p.post_status = 'publish'
            {$categoryWhere}
            ORDER BY p.ID ASC
            LIMIT {$limit} OFFSET {$offset}";
}

$postsResult = $db->query($sql);

// ============================================================
// 記事ごとにH2抽出 + CTA検出 + 要約
// ============================================================
$posts = [];

while ($row = $postsResult->fetch_assoc()) {
    $postId = (int)$row['ID'];
    $content = $row['post_content'];

    // URL構築
    $catPath = buildCategoryPath($postId, $postTermIds, $termSlugs, $termParents);
    $urlParts = [$siteUrl];
    if ($postsPagePrefix) $urlParts[] = $postsPagePrefix;
    $urlParts[] = $catPath;
    $urlParts[] = $postId;
    $url = implode('/', $urlParts);

    // カテゴリスラッグ取得
    $catSlug = '';
    if (isset($postTermIds[$postId]) && !empty($postTermIds[$postId])) {
        $firstTermId = $postTermIds[$postId][0];
        // 最も深い子カテゴリのslugを使用
        $catSlug = isset($termSlugs[$firstTermId]) ? $termSlugs[$firstTermId] : '';
    }

    // H2見出し抽出
    $sections = extractH2Sections($content);

    $posts[] = [
        'id' => $postId,
        'title' => $row['post_title'],
        'url' => $url,
        'category' => mapCategorySlug($catSlug),
        'sections' => $sections,
    ];
}

$postsResult->free();
$db->close();

echo json_encode([
    'generated_at' => date('Y-m-d H:i:s'),
    'total' => count($posts),
    'posts' => $posts,
], JSON_UNESCAPED_UNICODE);

// ============================================================
// H2見出し抽出 + セクション分割 + CTA検出 + 要約
// ============================================================
function extractH2Sections($content) {
    $sections = [];

    // Gutenbergブロック形式のH2を検出
    $pattern = '/<!-- wp:heading(?:\s+\{[^}]*\})?\s*-->\s*<h2[^>]*>([\s\S]*?)<\/h2>\s*<!-- \/wp:heading -->/i';
    if (!preg_match_all($pattern, $content, $matches, PREG_OFFSET_CAPTURE)) {
        // フォールバック: 生HTML
        $pattern = '/<h2[^>]*>([\s\S]*?)<\/h2>/i';
        if (!preg_match_all($pattern, $content, $matches, PREG_OFFSET_CAPTURE)) {
            return $sections;
        }
    }

    $h2Count = count($matches[0]);

    for ($i = 0; $i < $h2Count; $i++) {
        $headingText = strip_tags($matches[1][$i][0]);
        $headingEnd = $matches[0][$i][1] + strlen($matches[0][$i][0]);

        // セクション範囲: 見出し終了 ～ 次のH2開始（or コンテンツ末尾）
        $sectionEnd = ($i + 1 < $h2Count) ? $matches[0][$i + 1][1] : strlen($content);
        $sectionContent = substr($content, $headingEnd, $sectionEnd - $headingEnd);

        // CTA検出
        $hasCta = (
            preg_match('/<!-- wp:soico-cta\//', $sectionContent) === 1 ||
            preg_match('/\/recommends\/[a-z0-9_-]+/i', $sectionContent) === 1
        );

        // セクション要約（HTMLタグ除去、先頭150文字）
        $excerpt = '';
        if (!$hasCta) {
            $cleaned = preg_replace('/<!-- [\s\S]*?-->/', '', $sectionContent);
            $cleaned = strip_tags($cleaned);
            $cleaned = preg_replace('/\s+/', ' ', $cleaned);
            $cleaned = trim($cleaned);
            $excerpt = mb_substr($cleaned, 0, 150, 'UTF-8');
        }

        $sections[] = [
            'index' => $i + 1,
            'heading' => trim($headingText),
            'hasCta' => $hasCta,
            'excerpt' => $excerpt,
        ];
    }

    return $sections;
}

// ============================================================
// カテゴリスラッグ → システムカテゴリ名マッピング
// ============================================================
function mapCategorySlug($slug) {
    $map = [
        'cardloan' => 'cardloan', 'caching' => 'cardloan',
        'fx' => 'fx',
        'cryptocurrency' => 'cryptocurrency',
        'securities' => 'securities',
        'realestate' => 'realestate',
        'funding' => 'funding',
        'hiring' => 'hiring',
    ];
    return isset($map[$slug]) ? $map[$slug] : 'other';
}

// ============================================================
// カテゴリパス構築（generate_placement.php と同一ロジック）
// ============================================================
function buildCategoryPath($postId, $postTermIds, $termSlugs, $termParents) {
    if (!isset($postTermIds[$postId]) || empty($postTermIds[$postId])) {
        return 'uncategorized';
    }
    $termId = $postTermIds[$postId][0];
    $slugs = [];
    $current = $termId;
    $visited = [];
    while ($current > 0 && !in_array($current, $visited)) {
        $visited[] = $current;
        if (isset($termSlugs[$current])) {
            array_unshift($slugs, $termSlugs[$current]);
        }
        $current = isset($termParents[$current]) ? $termParents[$current] : 0;
    }
    return !empty($slugs) ? implode('/', $slugs) : 'uncategorized';
}
