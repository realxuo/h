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
            href:  `${BASE}/series/${item.content_id}`
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
        const seriesId = url.split("/").pop();
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
        // url could be a full URL or just a content_id
        // Extract just the content_id from the end
        const seriesId = url.split("/").pop().split("|")[0];
        console.log("[extractEpisodes] seriesId: " + seriesId);

        const res  = await soraFetch(`${API}/series/${seriesId}`);
        const data = await res.json();
        console.log("[extractEpisodes] seasons: " + (data.seasons || []).length);

        const seasons  = data.seasons || [];
        if (seasons.length === 0) {
            console.log("[extractEpisodes] no seasons found in response: " + JSON.stringify(data).slice(0, 200));
            return JSON.stringify([]);
        }

        const episodes = [];

        for (const season of seasons) {
            const seasonId  = season.content_id;
            const seasonNum = season.season_number || 1;
            const epCount   = season.episode_count || 0;
            const pages     = Math.ceil(epCount / 50) || 1;

            console.log(`[extractEpisodes] season ${seasonNum} id:${seasonId} eps:${epCount}`);

            for (let page = 1; page <= pages; page++) {
                try {
                    const epRes  = await soraFetch(`${API}/season/${seasonId}/episodes?page=${page}&limit=50&order_by=asc`);
                    const epList = await epRes.json();

                    for (const ep of (epList || [])) {
                        const epNum = ep.episode_number || 0;
                        episodes.push({
                            title:  ep.title
                                ? `S${seasonNum}E${epNum} - ${ep.title}`
                                : `Season ${seasonNum} Episode ${epNum}`,
                            href:   `${seasonId}|${ep.content_id}`,
                            number: parseFloat(epNum)
                        });
                    }
                } catch (pageErr) {
                    console.log(`[extractEpisodes] page error: ` + pageErr);
                }
            }
        }

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
        const parts     = href.split("|");
        const seasonId  = parts[0];
        const contentId = parts[1];

        // Get episode details to extract series_id and image hash
        const epRes  = await soraFetch(`${API}/content/${contentId}`);
        const epData = await epRes.json();

        const seriesId = epData.series_id;
        const imageUrl = epData.image || "";

        // Extract 32-char hash from image URL
        // e.g. ".../447037909c0f51fa11bddaef436ea16f.jpg" -> "447037909c0f51fa11bddaef436ea16f"
        const hashMatch = imageUrl.match(/\/([a-f0-9]{32})\.jpg/);
        const hash      = hashMatch ? hashMatch[1] : "";

        if (!seriesId || !hash) {
            console.log("Missing seriesId or hash - seriesId: " + seriesId + " hash: " + hash);
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        // Construct stream URL from known CDN pattern
        const baseStream = `${CDN}/episode/${seriesId}/${seasonId}/${contentId}/${hash}_ja-JP/hard/en-US`;
        const masterUrl  = `${baseStream}/master.m3u8`;

        console.log("Stream URL: " + masterUrl);

        return JSON.stringify({
            streams: [
                {
                    title:     "UniqueStream",
                    streamUrl: masterUrl,
                    headers: {
                        "Referer": BASE + "/"
                    }
                }
            ],
            subtitle: ""
        });
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