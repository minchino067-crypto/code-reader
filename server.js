const express = require('express');
const Parser = require('rss-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const parser = new Parser({ timeout: 9000 });

app.use(express.static(path.join(__dirname, 'public')));

const NITTER_INSTANCES = [
  'https://nitter.net',
  'https://nitter.poast.org',
  'https://nitter.privacydev.net',
];

async function fetchRSS(urlPath) {
  for (const base of NITTER_INSTANCES) {
    try {
      const feed = await parser.parseURL(base + urlPath);
      if (feed && feed.items && feed.items.length > 0) {
        return { ok: true, feed, instance: base, source: 'nitter' };
      }
    } catch (_) {}
  }
  return { ok: false, error: 'フィードの取得に失敗しました' };
}

// 複数RSSパスを並列取得して重複除去・時刻順ソートで返す
async function fetchUserRSSAll(username) {
  const paths = [
    `/${username}/rss`,
    `/${username}/with_replies/rss`,
    `/${username}/media/rss`,
  ];
  let instance = null;
  const results = await Promise.allSettled(paths.map(p => fetchRSS(p)));
  const seen = new Set();
  const allItems = [];

  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value.ok) continue;
    if (!instance) instance = r.value.instance;
    for (const item of r.value.feed.items) {
      const id = item.guid || item.link || item.title;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      allItems.push(parseItem(item, 'nitter'));
    }
  }

  allItems.sort((a, b) => {
    if (!a.time) return 1;
    if (!b.time) return -1;
    return new Date(b.time) - new Date(a.time);
  });

  if (allItems.length === 0) return { ok: false, error: 'フィードの取得に失敗しました' };
  return { ok: true, tweets: allItems, instance };
}

// img src を content HTML から全て抽出
function extractImages(html) {
  const imgs = [];
  const re = /<img[^>]+src="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) imgs.push(m[1]);
  return imgs;
}

// RSS item → tweet オブジェクト
function parseItem(item, source) {
  const title = item.title || '';
  const contentHtml = item.content || item['content:encoded'] || '';

  let isRetweet = false;
  let retweetedBy = null;
  let author = '';

  if (source === 'nitter') {
    // Nitter: "RT by @username: text"
    const rtMatch = title.match(/^RT by @(\S+?):\s*/i);
    isRetweet = !!rtMatch;
    retweetedBy = rtMatch ? rtMatch[1] : null;
    author = (item['dc:creator'] || item.creator || '').replace(/^@/, '');
  } else {
    // RSSHub: titleが "RT @username: text" か通常ツイート
    const rtMatch = title.match(/^RT @(\S+?):\s*/i);
    isRetweet = !!rtMatch;
    retweetedBy = rtMatch ? rtMatch[1] : null;
    // RSSHubはauthorフィールドかtitleの@から取得
    const creatorRaw = item['dc:creator'] || item.creator || item.author || '';
    author = creatorRaw.replace(/^@/, '');
    if (!author) {
      const m = title.match(/^(?:RT @\S+: )?@?(\S+)/);
      if (m) author = m[1].replace(/:$/, '');
    }
  }

  // テキスト（HTMLタグ除去）
  const text = (item.contentSnippet || contentHtml.replace(/<[^>]+>/g, ''))
    .replace(/\n{3,}/g, '\n\n').trim();

  // 画像
  const images = extractImages(contentHtml);

  const time = item.isoDate || null;

  return {
    id: item.guid || item.link,
    text,
    author: author || 'unknown',
    time,
    images,
    isRetweet,
    retweetedBy,
    link: item.link,
  };
}

// ユーザーフィード（3種のRSSを合算）
app.get('/api/user/:username', async (req, res) => {
  const { username } = req.params;
  const result = await fetchUserRSSAll(username);
  if (!result.ok) return res.status(502).json({ error: result.error });
  res.json({ tweets: result.tweets, instance: result.instance });
});

// 検索
app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'クエリが必要です' });
  const result = await fetchRSS(`/search/rss?q=${encodeURIComponent(q)}`);
  if (!result.ok) return res.status(502).json({ error: result.error });
  const tweets = result.feed.items.map(i => parseItem(i, result.source));
  res.json({ tweets, instance: result.instance });
});


app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
