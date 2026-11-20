//! Inline emoji in Lumen's main search: `:fire`, `:+1:`, `:قلب` and emoticons
//! such as `:)` or `<3` list matching emoji above the other results while the
//! Emoji extension is on. The data (`extensions/emoji/emoji.json`) and the
//! ranking are the extension's (`extensions/emoji/lib.mjs`); keep the two in
//! step, so a query finds the same emoji here and in the picker.
use serde::Deserialize;
use std::collections::HashMap;

/// How many emoji the main search lists at most.
pub const INLINE_LIMIT: usize = 8;
/// The extension that owns the data, the picker and the recently used list.
pub const EXTENSION: &str = "lumen.emoji";
/// Most recently used first, shared with the picker's "Recently Used".
const RECENT_LIMIT: usize = 24;

#[derive(Deserialize)]
struct Data {
    emoticons: HashMap<String, Vec<String>>,
    emoji: Vec<Raw>,
}
#[derive(Deserialize)]
struct Raw {
    e: String,
    n: String,
    g: usize,
    sg: u32,
    sc: Vec<String>,
    k: Vec<String>,
    #[serde(default)]
    fa: String,
    #[serde(default)]
    em: Vec<String>,
    #[serde(default)]
    t: Vec<String>,
    #[serde(default)]
    p: Option<u32>,
}

pub struct Emoji {
    pub glyph: String,
    /// The English name, as in the data: `slightly smiling face`.
    pub label: String,
    shortcodes: Vec<String>,
    name: String,
    persian: String,
    words: Vec<String>,
    phrases: Vec<String>,
    keywords: Vec<String>,
    emoticons: Vec<String>,
    tones: Vec<String>,
    group: (usize, u32),
    popular: u32,
}
impl Emoji {
    /// The emoji in a skin tone (1–5) when it comes in tones.
    pub fn with_tone(&self, tone: u64) -> &str {
        (1..=5)
            .contains(&tone)
            .then(|| self.tones.get(tone as usize - 1))
            .flatten()
            .unwrap_or(&self.glyph)
    }
    pub fn shortcode(&self) -> Option<&str> {
        self.shortcodes.first().map(String::as_str)
    }
    fn score(&self, query: &str, tokens: &[&str]) -> u32 {
        let shortcode = query.split_whitespace().collect::<Vec<_>>().join("_");
        if self.shortcodes.contains(&shortcode) {
            return 100;
        }
        if self.name == query || self.persian == query {
            return 95;
        }
        if self.shortcodes.iter().any(|c| c.starts_with(&shortcode)) {
            return 80;
        }
        if self.persian.starts_with(query) {
            return 79;
        }
        if self.phrases.iter().any(|k| k == query) {
            return 78;
        }
        if self.name.starts_with(query) {
            return 75;
        }
        let mut worst = u32::MAX;
        for &t in tokens {
            let mut best = 0;
            if self.words.iter().any(|w| w == t) {
                best = 70;
            } else if self.words.iter().any(|w| w.starts_with(t)) {
                best = 60;
            }
            if best < 55 && self.keywords.iter().any(|w| w == t) {
                best = 55;
            }
            if best < 50
                && self
                    .shortcodes
                    .iter()
                    .any(|c| c.split('_').any(|p| p.starts_with(t)))
            {
                best = 50;
            }
            if best < 45 && self.keywords.iter().any(|w| w.starts_with(t)) {
                best = 45;
            }
            if best < 30 && t.chars().count() >= 3 && self.name.contains(t) {
                best = 30;
            }
            if best == 0 {
                return 0;
            }
            worst = worst.min(best);
        }
        if worst == u32::MAX { 0 } else { worst }
    }
}

pub struct Index {
    emoji: Vec<Emoji>,
    emoticons: HashMap<String, Vec<String>>,
    by_glyph: HashMap<String, usize>,
}

/// Lowercases, folds Arabic-layout ي/ك to the Persian ی/ک CLDR uses, reads a
/// zero-width non-joiner as a space and drops diacritics such as the ٔ in گربهٔ.
pub fn fold(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .filter(|c| !matches!(c, '\u{64b}'..='\u{65f}' | '\u{670}'))
        .map(|c| match c {
            'ي' => 'ی',
            'ك' => 'ک',
            '\u{200c}' => ' ',
            c => c,
        })
        .collect()
}

fn words(text: &str) -> Vec<String> {
    fold(text)
        .split(|c: char| !(c.is_alphanumeric() || c == '+'))
        .filter(|w| !w.is_empty())
        .map(String::from)
        .collect()
}

/// `face with tears of joy` → `Face with Tears of Joy`, as lib.mjs does.
pub fn title_case(name: &str) -> String {
    const SMALL: [&str; 12] = [
        "a", "an", "and", "at", "for", "in", "of", "on", "or", "the", "to", "with",
    ];
    let mut out = String::with_capacity(name.len());
    let mut rest = name;
    while let Some(c) = rest.chars().next() {
        let starts_word = out.is_empty() || out.ends_with([' ', '(', '-']);
        if starts_word && c.is_lowercase() {
            let len = rest
                .find(|c: char| !(c.is_alphabetic() || c == '\''))
                .unwrap_or(rest.len());
            let word = &rest[..len];
            if out.is_empty() || !SMALL.contains(&word) {
                out.extend(c.to_uppercase());
                out.push_str(&word[c.len_utf8()..]);
            } else {
                out.push_str(word);
            }
            rest = &rest[len..];
        } else {
            out.push(c);
            rest = &rest[c.len_utf8()..];
        }
    }
    out
}

/// `:-)` → `:)`, `>:-(` → `>:(`. `:-1` keeps its dash only when the caller
/// tries the text as typed first, as `emoticon` does.
fn without_nose(raw: &str) -> String {
    let chars: Vec<char> = raw.chars().collect();
    let mut i = usize::from(chars.first() == Some(&'>'));
    if !chars.get(i).is_some_and(|c| ":;=8box0".contains(*c)) {
        return raw.into();
    }
    i += 1;
    if chars.get(i) == Some(&'\'') {
        i += 1;
    }
    if chars.get(i) == Some(&'-') && i + 1 < chars.len() {
        return chars[..i].iter().chain(&chars[i + 1..]).collect();
    }
    raw.into()
}

impl Index {
    pub fn parse(text: &str) -> anyhow::Result<Self> {
        let data: Data = serde_json::from_str(text)?;
        let emoji: Vec<Emoji> = data
            .emoji
            .into_iter()
            .map(|r| {
                let name_words = words(&r.n);
                let mut keywords: Vec<String> = Vec::new();
                for w in r.k.iter().flat_map(|k| words(k)) {
                    if !keywords.contains(&w) {
                        keywords.push(w);
                    }
                }
                Emoji {
                    name: fold(&r.n),
                    persian: fold(&r.fa),
                    words: name_words,
                    phrases: r.k,
                    keywords,
                    shortcodes: r.sc,
                    emoticons: r.em.iter().map(|e| e.to_lowercase()).collect(),
                    tones: r.t,
                    group: (r.g, r.sg),
                    popular: r.p.unwrap_or(10_000),
                    glyph: r.e,
                    label: r.n,
                }
            })
            .collect();
        let by_glyph = emoji
            .iter()
            .enumerate()
            .map(|(i, e)| (e.glyph.clone(), i))
            .collect();
        Ok(Self {
            emoji,
            emoticons: data.emoticons,
            by_glyph,
        })
    }

    pub fn get(&self, glyph: &str) -> Option<&Emoji> {
        self.by_glyph.get(glyph).map(|&i| &self.emoji[i])
    }

    /// The curated choices for an emoticon, then emojibase's, then the rest of
    /// the first one's subgroup. None when the text is not an emoticon.
    pub fn emoticon(&self, query: &str) -> Option<Vec<&Emoji>> {
        let raw = query.trim().to_lowercase();
        if raw.is_empty() {
            return None;
        }
        for key in [raw.clone(), without_nose(&raw)] {
            let curated = self
                .emoticons
                .get(&key)
                .into_iter()
                .flatten()
                .filter_map(|g| self.get(g));
            let known = self.emoji.iter().filter(|e| e.emoticons.contains(&key));
            let mut found: Vec<&Emoji> = curated.chain(known).collect();
            let Some(first) = found.first().map(|e| e.group) else {
                continue;
            };
            found.extend(self.emoji.iter().filter(|e| e.group == first));
            let mut seen = std::collections::HashSet::new();
            found.retain(|e| seen.insert(e.glyph.as_str()));
            return Some(found);
        }
        None
    }

    /// Emoji matching a name, keyword (English or Persian) or `:shortcode:`,
    /// best first; equally good matches put popular emoji first.
    pub fn search(&self, query: &str) -> Vec<&Emoji> {
        let folded = fold(query);
        let q = folded
            .trim()
            .trim_start_matches(':')
            .trim_end_matches(':')
            .trim();
        if q.is_empty() {
            return Vec::new();
        }
        let tokens: Vec<&str> = q
            .split(|c: char| c.is_whitespace() || c == '_')
            .filter(|t| !t.is_empty())
            .collect();
        let mut scored: Vec<(u32, usize)> = self
            .emoji
            .iter()
            .enumerate()
            .filter_map(|(i, e)| Some((e.score(q, &tokens), i)).filter(|(s, _)| *s > 0))
            .collect();
        scored.sort_by(|a, b| {
            b.0.cmp(&a.0)
                .then(self.emoji[a.1].popular.cmp(&self.emoji[b.1].popular))
                .then(a.1.cmp(&b.1))
        });
        scored.into_iter().map(|(_, i)| &self.emoji[i]).collect()
    }

    /// What the main search shows for `query`: an emoticon's emoji (`<3`,
    /// `:)`), or the matches of a `:` query of at least two letters. Plain
    /// words never match, so `fire` keeps finding apps and files.
    pub fn inline(&self, query: &str) -> Vec<&Emoji> {
        let q = query.trim();
        // Emoticons need punctuation, so `xd` or `zzz` stay ordinary searches.
        let punctuated =
            q.chars().any(|c| c.is_ascii_punctuation()) && !q.chars().any(char::is_whitespace);
        if punctuated && let Some(found) = self.emoticon(q) {
            return found.into_iter().take(INLINE_LIMIT).collect();
        }
        match q.strip_prefix(':') {
            Some(rest) if rest.trim_end_matches(':').trim().chars().count() >= 2 => {
                self.search(q).into_iter().take(INLINE_LIMIT).collect()
            }
            _ => Vec::new(),
        }
    }
}

/// Moves `glyph` to the front of the extension's recently used list, as the
/// picker does (`remember` in lib.mjs).
pub fn remember(recent: &serde_json::Value, glyph: &str) -> serde_json::Value {
    let mut list = vec![serde_json::Value::from(glyph)];
    list.extend(
        recent
            .as_array()
            .into_iter()
            .flatten()
            .filter(|g| g.as_str().is_some_and(|g| g != glyph))
            .cloned(),
    );
    list.truncate(RECENT_LIMIT);
    serde_json::Value::Array(list)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::LazyLock;

    static INDEX: LazyLock<Index> =
        LazyLock::new(|| Index::parse(include_str!("../extensions/emoji/emoji.json")).unwrap());
    fn glyphs(found: Vec<&Emoji>) -> Vec<&str> {
        found.into_iter().map(|e| e.glyph.as_str()).collect()
    }

    #[test]
    fn emoticons_suggest_related_emoji() {
        assert_eq!(glyphs(INDEX.inline(":)"))[..3], ["🙂", "😊", "😀"]);
        assert_eq!(glyphs(INDEX.inline(":-)"))[0], "🙂");
        assert_eq!(glyphs(INDEX.inline(":D"))[0], "😀");
        assert_eq!(glyphs(INDEX.inline("<3"))[0], "❤️");
        assert_eq!(glyphs(INDEX.inline(":-1"))[0], "👎");
        assert_eq!(glyphs(INDEX.inline("-_-"))[0], "😑");
        assert_eq!(INDEX.inline(":)").len(), INLINE_LIMIT);
        assert!(glyphs(INDEX.emoticon(":)").unwrap()).contains(&"😇"));
    }

    #[test]
    fn colon_queries_search_and_plain_words_do_not() {
        assert_eq!(glyphs(INDEX.inline(":fire"))[0], "🔥");
        assert_eq!(glyphs(INDEX.inline(":fire:"))[0], "🔥");
        assert_eq!(glyphs(INDEX.inline(":+1"))[0], "👍");
        assert_eq!(glyphs(INDEX.inline(":thumbs up"))[0], "👍");
        assert!(glyphs(INDEX.inline(":قلب"))[..3].contains(&"❤️"));
        assert!(glyphs(INDEX.inline(":لبخند")).contains(&"🙂"));
        assert!(INDEX.inline("fire").is_empty());
        assert!(INDEX.inline("xd").is_empty());
        assert!(INDEX.inline(":f").is_empty());
        assert!(INDEX.inline(":").is_empty());
        assert!(INDEX.inline("2+3").is_empty());
        assert!(INDEX.inline("~/Documents").is_empty());
    }

    #[test]
    fn matches_the_extensions_ranking() {
        // The same expectations as extensions/emoji/lib.test.mjs.
        assert_eq!(glyphs(INDEX.search("heart"))[0], "❤️");
        assert_eq!(glyphs(INDEX.search("rocket"))[0], "🚀");
        assert!(glyphs(INDEX.search("smile"))[..5].contains(&"😄"));
        assert_eq!(
            glyphs(INDEX.search("كيك"))[..3],
            glyphs(INDEX.search("کیک"))[..3]
        );
        assert!(INDEX.search("zzzqqq").is_empty());
    }

    #[test]
    fn tones_names_and_recent() {
        let wave = INDEX.get("👋").unwrap();
        assert_eq!(wave.with_tone(0), "👋");
        assert_eq!(wave.with_tone(3), "👋🏽");
        assert_eq!(INDEX.get("🔥").unwrap().with_tone(3), "🔥");
        assert_eq!(INDEX.get("🔥").unwrap().shortcode(), Some("fire"));
        assert_eq!(title_case("flag: Iran"), "Flag: Iran");
        assert_eq!(title_case("slightly smiling face"), "Slightly Smiling Face");
        assert_eq!(
            title_case("face with tears of joy"),
            "Face with Tears of Joy"
        );
        assert_eq!(title_case("a button (blood type)"), "A Button (Blood Type)");
        let recent = remember(&serde_json::json!(["🔥", "👍", 3]), "👍");
        assert_eq!(recent, serde_json::json!(["👍", "🔥"]));
        assert_eq!(
            remember(&serde_json::Value::Null, "🔥"),
            serde_json::json!(["🔥"])
        );
    }
}
