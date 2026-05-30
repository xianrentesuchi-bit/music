const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// クライアント静的ファイルの提供（index.htmlを配下に配置してください）
app.use(express.static(path.join(__dirname, 'public')));

// 利用可能なInvidiousインスタンスの配列
const INVIDIOUS_INSTANCES = [
    'https://inv.nadeko.net/',
    'https://invidious.f5.si/',
    'https://invidious.ritoge.com/',
    'https://invidious.ducks.party/',
    'https://super8.absturztau.be/',
    'https://yt.omada.cafe/',
    'https://iv.melmac.space/',
    'https://iv.duti.dev/'
];

// ヘルパー関数: 複数のインスタンスを巡回してフェッチを試みる
async function fetchWithFallback(endpointFactory) {
    let lastError = null;

    for (const instance of INVIDIOUS_INSTANCES) {
        // 末尾のスラッシュをクリーンアップしてURLを整形
        const baseUrl = instance.endsWith('/') ? instance.slice(0, -1) : instance;
        const targetUrl = endpointFactory(baseUrl);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000); // 6秒でタイムアウト

            const response = await fetch(targetUrl, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (response.ok) {
                const data = await response.json();
                return data;
            }
        } catch (error) {
            console.warn(`Instance failed: ${baseUrl} - ${error.message}`);
            lastError = error;
        }
    }

    throw new Error(`All Invidious instances failed. Last error: ${lastError ? lastError.message : 'Unknown'}`);
}

// 1. 楽曲検索 API
app.get('/api/search', async (req, res) => {
    const query = req.query.q;
    if (!query) {
        return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    try {
        // タイプを「video」に絞り込み、純粋な楽曲データを取得
        const results = await fetchWithFallback(baseUrl => 
            `${baseUrl}/api/v1/search?q=${encodeURIComponent(query)}&type=video`
        );

        // クライアントHTMLのオブジェクトスキーマに合わせてデータをマッピング
        const mappedTracks = results.map(video => ({
            id: video.videoId,
            title: video.title,
            author: video.author,
            thumbnail: video.videoThumbnails && video.videoThumbnails.length > 0 
                ? video.videoThumbnails.find(t => t.quality === 'medium' || t.quality === 'default')?.url || video.videoThumbnails[0].url
                : `https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg`
        }));

        res.json(mappedTracks);
    } catch (error) {
        console.error('Search API Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch search results from Invidious.' });
    }
});

// 2. ストリーミングURL抽出 API
app.get('/api/stream/:id', async (req, res) => {
    const videoId = req.params.id;

    try {
        const videoData = await fetchWithFallback(baseUrl => 
            `${baseUrl}/api/v1/videos/${encodeURIComponent(videoId)}`
        );

        // adaptiveFormats または formatStreams からオーディオストリームを抽出
        let audioUrl = null;

        if (videoData.adaptiveFormats && videoData.adaptiveFormats.length > 0) {
            // 最も適したオーディオストリームを検索（audio/mp4, audio/webmなど）
            const audioStreams = videoData.adaptiveFormats.filter(f => f.type && f.type.startsWith('audio/'));
            if (audioStreams.length > 0) {
                // ビットレートが極端に低くないフォーマット、または最初のものを選択
                const optimalStream = audioStreams.find(f => parseInt(f.bitrate) >= 128000) || audioStreams[0];
                audioUrl = optimalStream.url;
            }
        }

        // adaptiveFormatsにない場合、通常のformatStreamsからフォールバック
        if (!audioUrl && videoData.formatStreams && videoData.formatStreams.length > 0) {
            audioUrl = videoData.formatStreams[0].url;
        }

        if (audioUrl) {
            res.json({ url: audioUrl });
        } else {
            res.status(404).json({ error: 'Audio stream format not found for this video.' });
        }
    } catch (error) {
        console.error('Stream API Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch stream URL from Invidious.' });
    }
});

// その他のルートはすべてindex.htmlへリダイレクト（SPA対応）
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Spotify Clone Backend Server is running on port ${PORT}`);
});
