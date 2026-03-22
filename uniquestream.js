const BASE = "https://anime.uniquestream.net";
const API  = BASE + "/api/v1";
const CDN  = "https://get.mediacache.cc";

async function searchResults(keyword) {
    try {
        const res  = await soraFetch(`${API}/search?query=${encodeURIComponent(keyword)}&t=all&limit=20&page=1`);
        const data = await res.json();

        const series = data.series || [];
        const results = series.map(item => ({
            title: item.title || "",
            image: item.image || "",
            href:  item.content_id
        }));

        console.log("[searchResults] found: " + results.length);
        return JSON.stringify(results);
    } catch (e) {
        console.log("searchResults error: " + e);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        // url is the content_id from searchResults e.g. "Yv2I6x71"
        const seriesId = url.trim();
        console.log("[extractDetails] seriesId: " + seriesId);
        const res  = await soraFetch(`${API}/series/${seriesId}`);
        const data = await res.json();

        const description = data.description || "No description available";
        const airdate     = "Unknown";

        const audioLocales    = (data.audio_locales    || []).join(", ");
        const subtitleLocales = (data.subtitle_locales || []).join(", ");
        const seasonCount     = (data.seasons          || []).length;

        const aliases = [
            seasonCount     ? `Seasons: ${seasonCount}`          : null,
            audioLocales    ? `Audio: ${audioLocales}`           : null,
            subtitleLocales ? `Subtitles: ${subtitleLocales}`    : null,
        ].filter(Boolean).join("\n");

        return JSON.stringify([{ description, aliases, airdate }]);
    } catch (e) {
        console.log("extractDetails error: " + e);
        return JSON.stringify([{ description: "Error loading details", aliases: "", airdate: "" }]);
    }
}

async function extractEpisodes(url) {
    try {
        // url is the content_id from searchResults e.g. "Yv2I6x71"
        const seriesId = url.trim();
        console.log("[extractEpisodes] seriesId: " + seriesId);

        const res  = await soraFetch(`${API}/series/${seriesId}`);
        const data = await res.json();
        const seasons = data.seasons || [];
        console.log("[extractEpisodes] seasons: " + seasons.length);

        // Fetch all seasons in parallel
        const allEpisodes = await Promise.all(seasons.map(async (season) => {
            const seasonId  = season.content_id;
            const seasonNum = season.season_number || 1;
            const epCount   = season.episode_count || 0;
            const pages     = Math.ceil(epCount / 20) || 1;

            // Fetch all pages of this season in parallel
            const pageResults = await Promise.all(
                Array.from({ length: pages }, (_, i) => i + 1).map(async (page) => {
                    try {
                        const epUrl  = `${API}/season/${seasonId}/episodes?page=${page}&limit=20&order_by=asc`;
                        console.log("[extractEpisodes] fetching: " + epUrl);
                        const epRes  = await soraFetch(epUrl);
                        const epList = await epRes.json();
                        console.log("[extractEpisodes] season " + seasonNum + " page " + page + " got: " + (epList || []).length);
                        return (epList || []).map(ep => ({
                            title:  ep.title
                                ? `S${seasonNum}E${ep.episode_number} - ${ep.title}`
                                : `Season ${seasonNum} Episode ${ep.episode_number}`,
                            href:   `${seasonId}|${ep.content_id}`,
                            number: parseFloat(ep.episode_number || 0)
                        }));
                    } catch (e) {
                        console.log("[extractEpisodes] page error: " + e);
                        return [];
                    }
                })
            );

            return pageResults.flat();
        }));

        const episodes = allEpisodes.flat();
        console.log("[extractEpisodes] total: " + episodes.length);
        return JSON.stringify(episodes);
    } catch (e) {
        console.log("[extractEpisodes] error: " + e);
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(href) {
    // href = "seasonId|episodeContentId" e.g. "Y9V3ZgKQ|jjdZZWkd"
    try {
        const contentId = href.split("|")[1] || href;

        const res  = await soraFetch(`${API}/episode/${contentId}/media/dash/ja-JP`);
        const data = await res.json();

        const streams = [];
        const proxy   = "https://corsproxy.io/?url=";

        const localeNames = {
            "en-US":  "English",
            "de-DE":  "German",
            "es-419": "Spanish (LA)",
            "es-ES":  "Spanish (ES)",
            "it-IT":  "Italian",
            "pt-BR":  "Portuguese",
            "ar-SA":  "Arabic",
            "ru-RU":  "Russian",
            "tr-TR":  "Turkish"
        };

        // Add soft sub stream
        if (data.hls?.playlist) {
            streams.push({
                title:     "Raw (Soft Sub)",
                streamUrl: proxy + encodeURIComponent(data.hls.playlist)
            });
        }

        // Add hard sub streams for each locale
        const hardSubs = data.hls?.hard_subs || [];
        for (const sub of hardSubs) {
            const name = localeNames[sub.locale] || sub.locale;
            streams.push({
                title:     `Sub (${name})`,
                streamUrl: proxy + encodeURIComponent(sub.playlist)
            });
        }

        const subtitle = data.hls?.subtitles || "";

        console.log("[extractStreamUrl] streams: " + streams.length);
        return JSON.stringify({ streams, subtitle });
    } catch (e) {
        console.log("extractStreamUrl error: " + e);
        return JSON.stringify({ streams: [], subtitle: "" });
    }
}

async function soraFetch(url, options = {}) {
    const headers = options.headers ?? {};
    const method  = options.method  ?? "GET";
    const body    = options.body    ?? null;
    try {
        return await fetchv2(url, headers, method, body);
    } catch (e) {
        try {
            return await fetch(url, options);
        } catch (err) {
            console.log("soraFetch error: " + err);
            return null;
        }
    }
}