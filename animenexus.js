const BASE_API = "https://api.anime.nexus/api/anime";
const BASE_URL = "https://anime.nexus";

async function searchResults(keyword) {
    try {
        const url = BASE_API + "/shows?search=" + encodeURIComponent(keyword) +
            "&sortBy=name+asc&page=1&includes[]=poster&includes[]=genres&hasVideos=1";
        const res = await soraFetch(url);
        const data = await res.json();
        const shows = data.data || data.shows || data;
        return JSON.stringify(shows.map(s => ({
            title: s.name || s.title,
            image: s.poster ? (s.poster.url || s.poster) : (s.image || ""),
            href: s.id
        })));
    } catch (e) {
        console.log("searchResults error: " + e);
        return JSON.stringify([]);
    }
}

async function extractDetails(id) {
    try {
        const url = BASE_API + "/details/episodes?id=" + id +
            "&page=1&perPage=1&order=asc&fillers=true&recaps=true";
        const res = await soraFetch(url);
        const data = await res.json();
        const show = data.show || data.anime || {};
        return JSON.stringify([{
            description: show.description || show.synopsis || "No description available",
            aliases: show.alternativeTitles ? show.alternativeTitles.join(", ") : "Unknown",
            airdate: "Aired: " + (show.startDate || show.year || "Unknown")
        }]);
    } catch (e) {
        console.log("extractDetails error: " + e);
        return JSON.stringify([{ description: "Error loading details", aliases: "", airdate: "" }]);
    }
}

async function extractEpisodes(id) {
    try {
        const episodes = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const url = BASE_API + "/details/episodes?id=" + id +
                "&page=" + page + "&perPage=24&order=asc&fillers=true&recaps=true";
            const res = await soraFetch(url);
            const data = await res.json();
            const eps = data.data || data.episodes || [];

            eps.forEach(ep => {
                episodes.push({
                    href: ep.id,
                    number: ep.number || ep.episode || ep.episodeNumber || episodes.length + 1
                });
            });

            hasMore = eps.length === 24;
            page++;
            if (page > 20) break; // safety cap
        }

        return JSON.stringify(episodes);
    } catch (e) {
        console.log("extractEpisodes error: " + e);
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(episodeId) {
    try {
        // Get stream info to find the video ID
        const streamInfoUrl = BASE_API + "/details/episode/stream?id=" + episodeId + "&fillers=true&recaps=true";
        const streamInfoRes = await soraFetch(streamInfoUrl);
        const streamInfo = await streamInfoRes.json();

        console.log("[nexus] stream info: " + JSON.stringify(streamInfo).slice(0, 300));

        // Extract video ID from stream info
        const videoId = streamInfo.videoId || streamInfo.video_id ||
            (streamInfo.video && streamInfo.video.id) ||
            (streamInfo.data && streamInfo.data.videoId);

        if (!videoId) {
            console.log("[nexus] no videoId found in stream info");
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        const streamUrl = BASE_API + "/video/" + videoId + "/stream/video.m3u8";

        // Try to get subtitle (.ass format)
        let subtitle = "";
        const subUrl = streamInfo.subtitleUrl ||
            (streamInfo.subtitles && streamInfo.subtitles[0] && streamInfo.subtitles[0].url) || "";
        if (subUrl) subtitle = subUrl;

        return JSON.stringify({
            streams: [{ title: "Anime Nexus", streamUrl }],
            subtitle
        });
    } catch (e) {
        console.log("extractStreamUrl error: " + e);
        return JSON.stringify({ streams: [], subtitle: "" });
    }
}

async function soraFetch(url, options) {
    options = options || {};
    const headers = options.headers || {
        "Referer": BASE_URL + "/",
        "Origin": BASE_URL
    };
    const method = options.method || "GET";
    const body = options.body || null;
    try {
        return await fetchv2(url, headers, method, body);
    } catch (e) {
        try {
            return await fetch(url, { headers, method, body });
        } catch (e2) {
            throw e2;
        }
    }
}