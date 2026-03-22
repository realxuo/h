const BASE = "https://anizone.to";

async function searchResults(keyword) {
    try {
        const response = await soraFetch(`${BASE}/anime?search=${encodeURIComponent(keyword)}`);
        const html = await response.text();

        const results = [];
        const regex = /wire:key="a-([^"]+)"[\s\S]*?src="(https:\/\/anizone\.to\/images\/anime\/[^"]+)"[\s\S]*?href="(https:\/\/anizone\.to\/anime\/[^"]+)"\s+title="([^"]+)"/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
            results.push({
                title: match[4].trim(),
                image: match[2].trim(),
                href:  match[3].trim()
            });
        }

        return JSON.stringify(results);
    } catch (e) {
        console.log("searchResults error: " + e);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        const response = await soraFetch(url);
        const html = await response.text();

        // Description
        const descMatch = html.match(/<h3 class="sr-only">Synopsis<\/h3>\s*<div>([\s\S]*?)<\/div>/);
        const description = descMatch
            ? descMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
            : "No description available";

        // Year
        const yearMatch = html.match(/<span class="inline-block">(\d{4})<\/span>/);
        const airdate = yearMatch ? `Released: ${yearMatch[1]}` : "Released: Unknown";

        // Type
        const typeMatch = html.match(/<span class="inline-block">(TV Series|Movie|ONA|OVA|Special|Music Video)<\/span>/i);
        const mediaType = typeMatch ? typeMatch[1] : "Unknown";

        // Status
        const statusMatch = html.match(/<span class="inline-block">(Completed|Ongoing|Upcoming)<\/span>/i);
        const status = statusMatch ? statusMatch[1] : "Unknown";

        // Episode count
        const epMatch = html.match(/<span class="inline-block">(\d+) Episodes?<\/span>/i);
        const epCount = epMatch ? epMatch[1] : "Unknown";

        // Tags/genres
        const genres = [];
        const tagRegex = /href="https:\/\/anizone\.to\/tag\/[^"]+"[^>]*title="([^"]+)"/g;
        let tg;
        while ((tg = tagRegex.exec(html)) !== null) {
            if (!genres.includes(tg[1])) genres.push(tg[1]);
        }

        const aliases = [
            `Type: ${mediaType}`,
            `Status: ${status}`,
            `Episodes: ${epCount}`,
            `Genres: ${genres.join(", ") || "Unknown"}`
        ].join("\n");

        return JSON.stringify([{ description, aliases, airdate }]);
    } catch (e) {
        console.log("extractDetails error: " + e);
        return JSON.stringify([{ description: "Error loading details", aliases: "", airdate: "" }]);
    }
}

async function extractEpisodes(url) {
    try {
        const response = await soraFetch(url);
        const html = await response.text();

        const episodes = [];
        // Episodes are listed as: href="https://anizone.to/anime/{id}/{num}"
        // with title in <h3>Episode N : Title</h3>
        const epRegex = /href="(https:\/\/anizone\.to\/anime\/[^/]+\/(\d+))"[^>]*>\s*[\s\S]*?<h3[^>]*>Episode \d+ : ([^<]+)<\/h3>/g;
        let match;
        while ((match = epRegex.exec(html)) !== null) {
            episodes.push({
                title:  `Episode ${match[2]}: ${match[3].trim()}`,
                href:   match[1].trim(),
                number: parseInt(match[2])
            });
        }

        // Fallback: simpler pattern without titles
        if (episodes.length === 0) {
            const simpleRegex = /href="(https:\/\/anizone\.to\/anime\/[^/]+\/(\d+))"/g;
            const seen = new Set();
            while ((match = simpleRegex.exec(html)) !== null) {
                if (!seen.has(match[2])) {
                    seen.add(match[2]);
                    episodes.push({
                        title:  `Episode ${match[2]}`,
                        href:   match[1].trim(),
                        number: parseInt(match[2])
                    });
                }
            }
        }

        episodes.sort((a, b) => a.number - b.number);
        console.log("[extractEpisodes] total: " + episodes.length);
        return JSON.stringify(episodes);
    } catch (e) {
        console.log("extractEpisodes error: " + e);
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(url) {
    try {
        const response = await soraFetch(url);
        const html = await response.text();

        // Stream URL from <media-player src="...">
        const streamMatch = html.match(/<media-player[^>]+src="([^"]+\.m3u8)"/);
        const masterUrl = streamMatch ? streamMatch[1] : null;

        if (!masterUrl) {
            console.log("[extractStreamUrl] no stream found");
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        // Fetch master m3u8 and pick best variant with audio
        let finalUrl = masterUrl;
        try {
            const m3u8Res = await soraFetch(masterUrl);
            const m3u8Text = await m3u8Res.text();
            const lines = m3u8Text.split("\n");
            const variants = [];
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.startsWith("#EXT-X-STREAM-INF")) {
                    const hasAudio = /AUDIO=/i.test(line);
                    const bwMatch = line.match(/BANDWIDTH=(\d+)/);
                    const bandwidth = bwMatch ? parseInt(bwMatch[1]) : 0;
                    const uri = (lines[i + 1] || "").trim();
                    if (uri && !uri.startsWith("#")) {
                        variants.push({ bandwidth, uri, hasAudio });
                    }
                }
            }
            // Prefer variants with audio group, pick highest bandwidth
            const audioVariants = variants.filter(v => v.hasAudio);
            const best = (audioVariants.length > 0 ? audioVariants : variants)
                .sort((a, b) => b.bandwidth - a.bandwidth)[0];
            if (best) {
                finalUrl = best.uri.startsWith("http")
                    ? best.uri
                    : masterUrl.substring(0, masterUrl.lastIndexOf("/") + 1) + best.uri;
                console.log("[extractStreamUrl] variant: " + finalUrl + " hasAudio:" + best.hasAudio);
            }
        } catch (e) {
            console.log("[extractStreamUrl] m3u8 parse failed, using master: " + e);
        }

        // Chapters VTT (contains intro/outro timestamps)
        const chaptersMatch = html.match(/src="(https:\/\/seiryuu\.vid-cdn\.xyz\/[^"]+\/chapters\.vtt)"/);
        const chaptersUrl = chaptersMatch ? chaptersMatch[1] : null;

        // English subtitle (skip "Only Song & Signs")
        let subtitle = "";
        const trackRegex = /<track src=([^\s>]+\.srt)[^>]*label="([^"]*)"[^>]*>/gi;
        let tm;
        while ((tm = trackRegex.exec(html)) !== null) {
            if (!/song|sign/i.test(tm[2])) {
                subtitle = tm[1].replace(/^["']|["']$/g, "");
                break;
            }
        }

        const stream = { title: "AniZone", streamUrl: finalUrl };
        if (chaptersUrl) stream.chapters = chaptersUrl;

        return JSON.stringify({ streams: [stream], subtitle });
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