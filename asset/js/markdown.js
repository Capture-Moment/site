/**
 * Mini Markdown renderer — safe by construction.
 *
 * 1. Escape ALL HTML characters first: the LLM output can never carry
 *    a live tag (<script>, <img onerror>...).
 * 2. Then convert Markdown into a WHITELIST of tags we generate ourselves.
 *
 * => innerHTML with this output is safe: only tags created below exist.
 */

function escapeHtml(t) {
    return t
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")   // also protect attribute contexts (href="...")
        .replace(/'/g, "&#39;");
}

export function renderMarkdown(md) {
    let t = escapeHtml(md);

    // [text](url) — accepts http(s) AND mailto: links (e.g. [email](mailto:...))
    t = t.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // <https://...> autolinks — escaped form is &lt;...&gt;  ← NEW
    t = t.replace(/&lt;(https?:\/\/[^\s<>]+)&gt;/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

    // bare URLs — must stay AFTER autolinks                ← NEW comment
    t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
        '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');


    // bold then italic (bold first, otherwise ** gets eaten by *)
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");

    // block structure: headings, bullet lists, paragraphs
    const out = [];
    let inList = false;
    for (const line of t.split("\n")) {
        const heading = line.match(/^#{1,4}\s+(.*)/);
        const bullet = line.match(/^\s*[-*•]\s+(.*)/);

        if (bullet) {
            if (!inList) { out.push("<ul>"); inList = true; }
            out.push(`<li>${bullet[1]}</li>`);
            continue;
        }
        if (inList) { out.push("</ul>"); inList = false; }
        if (heading) out.push(`<h4>${heading[1]}</h4>`);
        else if (line.trim() === "") out.push("<br>");
        else out.push(`<p>${line}</p>`);
    }
    if (inList) out.push("</ul>");
    return out.join("");
}
