<?php
/**
 * 記事一覧取得API（DB直接アクセス）
 *
 * サーバー上のDBに直接アクセスし、公開済み記事の
 * postId / title / URL をJSONで返却する。
 *
 * generate_placement.php（article_list_maker）のDB接続パターンを踏襲。
 *
 * Usage:
 *   list_posts.php?token=SECRET
 *   list_posts.php?token=SECRET&category=securities
 *
 * Parameters:
 *   token    (必須) セキュリティトークン
 *   category (任意) カテゴリスラッグでフィルタ（例: securities, cardloan, cryptocurrency）
 *
 * Response:
 *   {
 *     "generated_at": "2026-04-10 14:00:00",
 *     "total_posts": 2000,
 *     "posts": [
 *       {"id": 5286, "title": "新NISA...", "url": "https://..."},
 *       ...
 *     ]
 *   }
 */

header('Content-Type: application/json; charset=utf-8');

// ============================================================
// セキュリティトークン（generate_placement.php と共通）
// ============================================================
define('SECRET_TOKEN', 'ta_placement_8f3k2m9x7v1q4w6e');

if (!isset($_GET['token']) || $_GET['token'] !== SECRET_TOKEN) {
    http_response_code(403);
    die(json_encode(['error' => 'Forbidden'], JSON_UNESCAPED_UNICODE));
}

// ============================================================
// DB接続（wp-config.phpから読み取り）
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
// サイトURL + 投稿ページプレフィックス取得
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

// ============================================================
// カテゴリ階層情報（URL構築用）
// ============================================================
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

// 記事→カテゴリterm_idのマッピング
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
// カテゴリフィルタ（任意）
// ============================================================
$categoryFilter = isset($_GET['category']) ? $_GET['category'] : null;
$filterTermId = null;

if ($categoryFilter) {
    foreach ($termSlugs as $tid => $slug) {
        if ($slug === $categoryFilter) {
            $filterTermId = $tid;
            break;
        }
    }
    if ($filterTermId === null) {
        // 指定されたカテゴリが存在しない
        echo json_encode([
            'generated_at' => date('Y-m-d H:i:s'),
            'total_posts' => 0,
            'posts' => [],
            'error' => "Category not found: {$categoryFilter}",
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

// ============================================================
// 全記事取得
// ============================================================
$sql = "SELECT ID, post_title, post_name
        FROM {$prefix}posts
        WHERE post_type = 'post' AND post_status = 'publish'
        ORDER BY ID ASC";
$postsResult = $db->query($sql);

$posts = [];
while ($row = $postsResult->fetch_assoc()) {
    $postId = (int)$row['ID'];

    // カテゴリフィルタ
    if ($filterTermId !== null) {
        $postCats = isset($postTermIds[$postId]) ? $postTermIds[$postId] : [];
        if (!in_array($filterTermId, $postCats)) continue;
    }

    // URL構築
    $catPath = buildCategoryPath($postId, $postTermIds, $termSlugs, $termParents);
    $urlParts = [$siteUrl];
    if ($postsPagePrefix) $urlParts[] = $postsPagePrefix;
    $urlParts[] = $catPath;
    $urlParts[] = $postId;
    $url = implode('/', $urlParts);

    $posts[] = [
        'id' => $postId,
        'title' => $row['post_title'],
        'url' => $url,
    ];
}
$postsResult->free();
$db->close();

// ============================================================
// JSON出力
// ============================================================
echo json_encode([
    'generated_at' => date('Y-m-d H:i:s'),
    'total_posts' => count($posts),
    'posts' => $posts,
], JSON_UNESCAPED_UNICODE);

// ============================================================
// ユーティリティ（generate_placement.php と同一ロジック）
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
