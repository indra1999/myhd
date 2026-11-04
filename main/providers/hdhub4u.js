/**
 * HDHub4u Provider for Nuvio
 * Domain: new11.hdhub4u.cl (+ auto mirror fallback)
 * Exports: getStreams(tmdbId, mediaType, season, episode)
 */

var __async = (thisArg, args, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try { step(generator.next(value)); } catch (e) { reject(e); }
    };
    var rejected = (value) => {
      try { step(generator.throw(value)); } catch (e) { reject(e); }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(thisArg, args)).next());
  });
};

// ─── Config ──────────────────────────────────────────────────────────────────
var MIRRORS = [
  "https://new11.hdhub4u.cl",
  "https://new10.hdhub4u.cl",
  "https://new9.hdhub4u.cl",
  "https://new8.hdhub4u.cl",
  "https://new6.hdhub4u.fo",
  "https://new5.hdhub4u.fo",
  "https://new3.hdhub4u.fo",
  "https://hdhub4u.fo"
];

var SEARCH_API = "https://search.hdhub4u.glass/collections/post/documents/search";
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_BASE = "https://api.themoviedb.org/3";

var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cookie": "xla=s4t"
};

var currentBase = MIRRORS[0];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function normalizeTitle(t) {
  if (!t) return "";
  return t.toLowerCase()
    .replace(/\b(the|a|an)\b/g, "")
    .replace(/[:\-_]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "")
    .trim();
}

function titleSimilarity(a, b) {
  var n1 = normalizeTitle(a);
  var n2 = normalizeTitle(b);
  if (n1 === n2) return 1;
  var w1 = n1.split(/\s+/).filter(Boolean);
  var w2 = n2.split(/\s+/).filter(Boolean);
  if (!w1.length || !w2.length) return 0;
  var set2 = {};
  for (var i = 0; i < w2.length; i++) set2[w2[i]] = true;
  var inter = 0;
  for (var j = 0; j < w1.length; j++) if (set2[w1[j]]) inter++;
  var union = {};
  for (var k = 0; k < w1.length; k++) union[w1[k]] = true;
  for (var m = 0; m < w2.length; m++) union[w2[m]] = true;
  var unionSize = 0;
  for (var _ in union) unionSize++;
  return inter / unionSize;
}

function qualityFromText(text) {
  if (!text) return "Unknown";
  var t = text.toUpperCase();
  if (t.indexOf("2160") !== -1 || t.indexOf("4K") !== -1) return "4K";
  if (t.indexOf("1080") !== -1) return "1080p";
  if (t.indexOf("720") !== -1) return "720p";
  if (t.indexOf("480") !== -1) return "480p";
  return "Unknown";
}

function sizeFromText(text) {
  if (!text) return null;
  var m = text.match(/(\d+(?:\.\d+)?)\s*(GB|MB|TB)/i);
  if (!m) return null;
  return m[1] + " " + m[2].toUpperCase();
}

// ─── TMDB ────────────────────────────────────────────────────────────────────
function getTMDBDetails(tmdbId, mediaType) {
  return __async(this, null, function* () {
    var endpoint = mediaType === "tv" || mediaType === "series" ? "tv" : "movie";
    var url = TMDB_BASE + "/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_API_KEY + "&append_to_response=external_ids";
    var res = yield fetch(url, { headers: { Accept: "application/json", "User-Agent": HEADERS["User-Agent"] } });
    if (!res.ok) throw new Error("TMDB " + res.status);
    var data = yield res.json();
    var title = endpoint === "tv" ? data.name : data.title;
    var date = endpoint === "tv" ? data.first_air_date : data.release_date;
    var year = date ? parseInt(date.split("-")[0], 10) : null;
    var imdbId = (data.external_ids && data.external_ids.imdb_id) || null;
    return { title: title, year: year, imdbId: imdbId };
  });
}

// ─── Search (Typesense API used by HDHub4u) ──────────────────────────────────
function searchPosts(query) {
  return __async(this, null, function* () {
    var today = new Date().toISOString().split("T")[0];
    var url = SEARCH_API +
      "?q=" + encodeURIComponent(query) +
      "&query_by=post_title,category&query_by_weights=4,2&sort_by=sort_by_date:desc&limit=20&highlight_fields=none&use_cache=true&page=1&analytics_tag=" + today;

    var res = yield fetch(url, { headers: HEADERS });
    if (!res.ok) return [];
    var data = yield res.json();
    if (!data || !data.hits) return [];

    return data.hits.map(function (hit) {
      var doc = hit.document;
      var title = doc.post_title || "";
      var yearMatch = title.match(/\((\d{4})\)|\b(20\d{2}|19\d{2})\b/);
      var year = yearMatch ? parseInt(yearMatch[1] || yearMatch[2], 10) : null;
      var link = doc.permalink || "";
      if (link && link.charAt(0) === "/") link = currentBase + link;
      return {
        title: title,
        url: link,
        poster: doc.post_thumbnail || null,
        year: year
      };
    });
  });
}

function findBestMatch(mediaInfo, results, mediaType, season) {
  if (!results || !results.length) return null;
  var best = null;
  var bestScore = 0;

  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var score = titleSimilarity(mediaInfo.title, r.title);

    if (mediaInfo.year && r.year) {
      var diff = Math.abs(mediaInfo.year - r.year);
      if (diff === 0) score += 0.25;
      else if (diff === 1) score += 0.1;
      else if (diff > 3) score -= 0.3;
    }

    if ((mediaType === "tv" || mediaType === "series") && season) {
      var lower = (r.title || "").toLowerCase();
      var hasSeason = lower.indexOf("season " + season) !== -1 ||
        lower.indexOf("s" + season) !== -1 ||
        lower.indexOf("season " + String(season).padStart(2, "0")) !== -1;
      if (hasSeason) score += 0.4;
      else score -= 0.25;
    }

    if (score > bestScore && score > 0.35) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

// ─── Page parsing & extractors ───────────────────────────────────────────────
function getCheerio() {
  try {
    return require("cheerio-without-node-native");
  } catch (e) {
    return null;
  }
}

function extractPageLinks(html, pageUrl) {
  var cheerio = getCheerio();
  if (!cheerio) return [];

  var $ = cheerio.load(html);
  var links = [];
  var seen = {};

  // Quality heading links + body download links
  $("h3 a, h4 a, .page-body a, .entry-content a, a").each(function (i, el) {
    var href = $(el).attr("href");
    var text = ($(el).text() || "").trim();
    if (!href) return;
    if (href.indexOf("javascript:") === 0) return;

    var lower = href.toLowerCase();
    var isCandidate =
      lower.indexOf("hdstream") !== -1 ||
      lower.indexOf("hubcloud") !== -1 ||
      lower.indexOf("hubstream") !== -1 ||
      lower.indexOf("hblinks") !== -1 ||
      lower.indexOf("hubcdn") !== -1 ||
      lower.indexOf("pixeldrain") !== -1 ||
      lower.indexOf("gofile") !== -1 ||
      lower.indexOf("drive") !== -1 ||
      /480|720|1080|2160|4k/i.test(text);

    if (!isCandidate) return;
    if (seen[href]) return;
    seen[href] = true;

    links.push({
      url: href,
      name: text || "Download",
      quality: qualityFromText(text),
      size: sizeFromText(text)
    });
  });

  return links;
}

function resolveRedirect(url) {
  return __async(this, null, function* () {
    try {
      var res = yield fetch(url, {
        headers: Object.assign({}, HEADERS, { Referer: currentBase + "/" }),
        redirect: "follow"
      });
      // Many intermediate pages just redirect; final URL is useful
      return res.url || url;
    } catch (e) {
      return url;
    }
  });
}

function buildStreamObject(link, mediaInfo) {
  var nameParts = ["HDHub4u"];
  if (link.quality && link.quality !== "Unknown") nameParts.push(link.quality);
  if (link.size) nameParts.push(link.size);
  if (link.name && link.name.length < 40) nameParts.push(link.name);

  return {
    name: nameParts.join(" • "),
    title: mediaInfo.title + (mediaInfo.year ? " (" + mediaInfo.year + ")" : ""),
    url: link.url,
    quality: link.quality || "Unknown",
    size: link.size || null,
    type: "direct",
    behaviorHints: {
      bingeGroup: "hdhub4u",
      notWebReady: false
    }
  };
}

// ─── Main entry ──────────────────────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    try {
      if (!tmdbId) return [];

      var type = mediaType === "series" ? "tv" : (mediaType || "movie");
      var mediaInfo = yield getTMDBDetails(tmdbId, type);

      var query = mediaInfo.title;
      if (type === "tv" && season) {
        query = mediaInfo.title + " Season " + season;
      }

      var results = yield searchPosts(query);
      if (!results.length) {
        // fallback: title only
        results = yield searchPosts(mediaInfo.title);
      }
      if (!results.length) return [];

      var match = findBestMatch(mediaInfo, results, type, season);
      if (!match || !match.url) return [];

      // Ensure absolute URL on current base
      var pageUrl = match.url;
      if (pageUrl.indexOf("http") !== 0) {
        pageUrl = currentBase + (pageUrl.charAt(0) === "/" ? pageUrl : "/" + pageUrl);
      }

      var pageRes = yield fetch(pageUrl, {
        headers: Object.assign({}, HEADERS, { Referer: currentBase + "/" })
      });
      if (!pageRes.ok) {
        // try next mirrors quickly
        for (var mi = 1; mi < Math.min(MIRRORS.length, 4); mi++) {
          currentBase = MIRRORS[mi];
          var altUrl = pageUrl.replace(/https?:\/\/[^/]+/, currentBase);
          pageRes = yield fetch(altUrl, {
            headers: Object.assign({}, HEADERS, { Referer: currentBase + "/" })
          });
          if (pageRes.ok) {
            pageUrl = altUrl;
            break;
          }
        }
      }
      if (!pageRes.ok) return [];

      var html = yield pageRes.text();
      var rawLinks = extractPageLinks(html, pageUrl);
      if (!rawLinks.length) return [];

      var streams = [];
      var seenFinal = {};

      for (var i = 0; i < rawLinks.length; i++) {
        var L = rawLinks[i];
        var finalUrl = L.url;

        // light resolve for intermediate short links
        if (
          finalUrl.indexOf("hdhub4u") !== -1 ||
          finalUrl.indexOf("hubcloud") !== -1 ||
          finalUrl.indexOf("hdstream") !== -1
        ) {
          try {
            finalUrl = yield resolveRedirect(finalUrl);
          } catch (e) {}
        }

        if (seenFinal[finalUrl]) continue;
        seenFinal[finalUrl] = true;

        streams.push(buildStreamObject({
          url: finalUrl,
          name: L.name,
          quality: L.quality,
          size: L.size
        }, mediaInfo));
      }

      // Prefer higher quality first
      streams.sort(function (a, b) {
        var order = { "4K": 4, "1080p": 3, "720p": 2, "480p": 1, "Unknown": 0 };
        return (order[b.quality] || 0) - (order[a.quality] || 0);
      });

      return streams;
    } catch (err) {
      console.log("[HDHub4u] error: " + (err && err.message ? err.message : err));
      return [];
    }
  });
}

module.exports = { getStreams };

