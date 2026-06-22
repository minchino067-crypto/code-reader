const express = require('express');
const Parser = require('rss-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const parser = new Parser({ timeout: 9000 });

app.use(express.static(path.join(__dirname, 'public')));

// nitter.net が唯一安定して動くインスタンス
const INSTANCES = [
  'https://nitter.net',
  'https://nitter.poast.org',
  'https://nitter.privacydev.net',
];

async function fetchRSS(urlPath) {
  for (const base of INSTANCES) {
    try {
      const feed = await parser.parseURL(base + urlPath);
      return { ok: true, feed, instance: base };
    } catch (_) {}
  }
  return { ok: false, error: 'Nitterに接続できませんでした' };
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
function parseItem(item) {
  const title = item.title || '';

  // リポスト判定: "RT by @username: text"
  const rtMatch = title.match(/^RT by @(\S+?):\s*/i);
  const isRetweet = !!rtMatch;
  const retweetedBy = rtMatch ? rtMatch[1] : null;  // リポストした人

  // 投稿者: dc:creator または creator フィールド
  const author = (item['dc:creator'] || item.creator || '').replace(/^@/, '');

  // テキスト: contentSnippet（HTMLタグなし）
  const text = (item.contentSnippet || '').replace(/\n{3,}/g, '\n\n').trim();

  // 画像: content HTML から抽出
  const images = extractImages(item.content || '');

  // 時刻: isoDate が最も信頼できる
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

// ユーザーフィード
app.get('/api/user/:username', async (req, res) => {
  const { username } = req.params;
  const result = await fetchRSS(`/${username}/rss`);
  if (!result.ok) return res.status(502).json({ error: result.error });
  const tweets = result.feed.items.map(parseItem);
  res.json({ tweets, instance: result.instance });
});

// 検索
app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'クエリが必要です' });
  const result = await fetchRSS(`/search/rss?q=${encodeURIComponent(q)}`);
  if (!result.ok) return res.status(502).json({ error: result.error });

  const tweets = result.feed.items.map(item => {
    // 検索結果のtitleは "@author: text" か "RT by @..." 形式
    const tweet = parseItem(item);
    // authorが空なら title から抜く
    if (!tweet.author || tweet.author === 'unknown') {
      const m = item.title?.match(/^(?:RT by @\S+: )?@?(\S+?):/);
      if (m) tweet.author = m[1];
    }
    return tweet;
  });
  res.json({ tweets, instance: result.instance });
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
