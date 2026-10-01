const axios = require('axios');
const TMDB_BASE_URL = 'https://api.themoviedb.org';

// 创建缓存对象
const cache = new Map();
const CACHE_DURATION = 10 * 60 * 1000;
const MAX_CACHE_SIZE = 1000;

function cleanExpiredCache() {
    const now = Date.now();
    for (const [key, value] of cache.entries()) {
        if (now > value.expiry) {
            cache.delete(key);
        }
    }
}

function checkCacheSize() {
    if (cache.size > MAX_CACHE_SIZE) {
        const entries = Array.from(cache.entries());
        entries.sort((a, b) => a[1].expiry - b[1].expiry);
        const deleteCount = cache.size - MAX_CACHE_SIZE;
        entries.slice(0, deleteCount).forEach(([key]) => cache.delete(key));
        console.log(`Cleaned ${deleteCount} old cache entries`);
    }
}

module.exports = async (req, res) => {
    // 处理 CORS
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const fullPath = req.url;
        const authHeader = req.headers.authorization;
        const cacheKey = `${fullPath}_${authHeader || ''}`;

        cleanExpiredCache();

        if (cache.has(cacheKey)) {
            const cachedData = cache.get(cacheKey);
            if (Date.now() < cachedData.expiry) {
                console.log('Cache hit:', fullPath);
                return res.status(200).json(cachedData.data);
            } else {
                cache.delete(cacheKey);
            }
        }

        const tmdbUrl = `${TMDB_BASE_URL}${fullPath}`;
        const config = {
            timeout: 15000 // 增加 15 秒强制超时机制，防止死锁
        };

        if (authHeader) {
            config.headers = { 'Authorization': authHeader };
        }

        const response = await axios.get(tmdbUrl, config);

        if (response.status === 200) {
            checkCacheSize();
            cache.set(cacheKey, {
                data: response.data,
                expiry: Date.now() + CACHE_DURATION
            });
            console.log('Cache miss and stored:', fullPath);
        } else {
            console.log('Response not cached due to non-200 status:', response.status);
        }

        res.status(response.status).json(response.data);
    } catch (error) {
        console.error('TMDB API error:', error.message);
        // 如果是超时（ECONNABORTED），返回 504 Gateway Timeout 让客户端立刻重试，而不是无意义死等
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            return res.status(504).json({ error: 'Upstream connection timed out' });
        }
        res.status(error.response?.status || 500).json({
            error: error.message,
            details: error.response?.data
        });
    }
};
