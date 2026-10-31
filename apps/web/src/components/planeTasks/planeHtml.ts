import DOMPurify from "dompurify";

/**
 * Plane stores task descriptions and comments as HTML. The visual editor can only
 * represent part of that HTML, so a document is classified before it is loaded and
 * anything the editor would drop is kept in the original bytes instead.
 */

const TAG_PATTERN = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ATTRIBUTE_PATTERN =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Tags the visual editor maps to a document node or a mark. */
const EDITOR_TAGS: ReadonlySet<string> = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "strike",
  "strong",
  "u",
  "ul",
]);

/** Non-semantic wrappers whose text survives the round trip. */
const TRANSPARENT_TAGS: ReadonlySet<string> = new Set(["div", "span"]);

/** Attributes the editor keeps on a supported tag; every other one is dropped. */
const PRESERVED_ATTRIBUTES: ReadonlySet<string> = new Set(["href", "rel", "target"]);

/** What the reader loses when a tag the editor cannot represent is dropped. */
const UNSUPPORTED_LABELS: Readonly<Record<string, string>> = {
  applet: "embedded objects",
  area: "image maps",
  article: "article blocks",
  aside: "sidebars",
  audio: "embedded media",
  base: "page metadata",
  blink: "blinking text",
  button: "form controls",
  canvas: "drawings",
  col: "tables",
  colgroup: "tables",
  dd: "definition lists",
  details: "expandable sections",
  dialog: "dialogs",
  dl: "definition lists",
  dt: "definition lists",
  embed: "embedded objects",
  fieldset: "form controls",
  figcaption: "figure captions",
  figure: "figure captions",
  font: "font styling",
  footer: "page footers",
  form: "form controls",
  frame: "embedded frames",
  frameset: "frames",
  header: "page headers",
  iframe: "embedded frames",
  img: "images",
  input: "form controls",
  keygen: "form controls",
  label: "form controls",
  legend: "form controls",
  link: "linked stylesheets",
  main: "main content",
  map: "image maps",
  mark: "highlighted text",
  marquee: "marquees",
  math: "math formulas",
  menu: "menus",
  meta: "page metadata",
  meter: "form controls",
  nav: "navigation blocks",
  noscript: "scripts",
  object: "embedded objects",
  optgroup: "form controls",
  option: "form controls",
  output: "form controls",
  picture: "images",
  progress: "form controls",
  script: "scripts",
  section: "content sections",
  select: "form controls",
  slot: "slots",
  source: "images",
  style: "style blocks",
  sub: "subscripts",
  sup: "superscripts",
  summary: "expandable sections",
  svg: "drawings",
  table: "tables",
  tbody: "tables",
  td: "tables",
  textarea: "form controls",
  tfoot: "tables",
  th: "tables",
  thead: "tables",
  tr: "tables",
  video: "embedded media",
};

const SANITIZED_TAGS: readonly string[] = [
  "a",
  "b",
  "blockquote",
  "br",
  "caption",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
];

const SANITIZED_ATTRIBUTES: readonly string[] = [
  "alt",
  "colspan",
  "dir",
  "height",
  "href",
  "lang",
  "rel",
  "rowspan",
  "scope",
  "src",
  "start",
  "title",
  "type",
  "width",
];

/** Only raster images over a safe scheme; SVG can carry script. */
const SAFE_IMAGE_SOURCE = /^(?:https?:\/\/|data:image\/(?:avif|gif|jpeg|jpg|png|webp);base64,)/i;

export type PlaneHtmlAnalysis = {
  /** Features the visual editor cannot represent, phrased for the reader. */
  readonly unsupported: readonly string[];
};

/** Typography for Plane HTML, shared by the rendered view and the editor. */
export const PLANE_HTML_CONTENT_CLASS = [
  "min-w-0 text-sm leading-relaxed wrap-anywhere",
  "[&_a]:underline [&_a]:underline-offset-2",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
  "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold",
  "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold",
  "[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-semibold",
  "[&_h4]:mt-3 [&_h4]:mb-1.5 [&_h4]:font-semibold",
  "[&_h5]:mt-2 [&_h5]:mb-1 [&_h5]:font-semibold",
  "[&_h6]:mt-2 [&_h6]:mb-1 [&_h6]:font-semibold",
  "[&_img]:max-w-full [&_img]:rounded",
  "[&_li]:my-0.5",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_p]:my-2",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs",
  "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs",
  "[&_td]:border [&_td]:border-border [&_td]:p-2",
  "[&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:p-2 [&_th]:text-left",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
].join(" ");

function unsupportedLabel(tag: string): string {
  return UNSUPPORTED_LABELS[tag] ?? `<${tag}> elements`;
}

function unsupportedAttributeLabel(name: string): string {
  if (name === "class") return "class attributes";
  if (name === "style") return "inline styles";
  if (name.startsWith("data-")) return `${name} metadata`;
  if (name.startsWith("aria-")) return "accessibility attributes";
  return `${name} attributes`;
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Report what a visual editor would drop from this document.
 *
 * The result drives the editor's mode: a document with nothing unsupported is
 * edited visually, and one with unsupported features is edited as HTML source
 * unless the reader chooses the visual editor and accepts the loss.
 */
export function analyzePlaneHtml(html: string): PlaneHtmlAnalysis {
  const unsupported = new Set<string>();
  if (html.includes("<!--")) {
    unsupported.add("HTML comments");
  }
  for (const match of html.matchAll(TAG_PATTERN)) {
    const tag = match[2]!.toLowerCase();
    if (!EDITOR_TAGS.has(tag) && !TRANSPARENT_TAGS.has(tag)) {
      unsupported.add(unsupportedLabel(tag));
      continue;
    }
    for (const attribute of (match[3] ?? "").matchAll(ATTRIBUTE_PATTERN)) {
      const name = attribute[1]!.toLowerCase();
      if (!PRESERVED_ATTRIBUTES.has(name)) {
        unsupported.add(unsupportedAttributeLabel(name));
      }
    }
  }
  return { unsupported: [...unsupported] };
}

/**
 * Reduce Plane HTML to the tags and attributes this app renders.
 *
 * Scripts, event handlers, `javascript:` links, inline styles and remote CSS
 * classes never survive, and an image is kept only when it points at a safe scheme.
 */
export function sanitizePlaneHtml(html: string): string {
  if (!DOMPurify.isSupported) {
    // Without a DOM there is nothing to sanitize against, so show the source instead.
    return escapeHtmlText(html);
  }
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: [...SANITIZED_TAGS],
    ALLOWED_ATTR: [...SANITIZED_ATTRIBUTES],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORBID_ATTR: ["style", "srcset", "ping", "formaction", "xlink:href"],
  });
  for (const image of fragment.querySelectorAll("img")) {
    const source = image.getAttribute("src") ?? "";
    if (!SAFE_IMAGE_SOURCE.test(source)) {
      image.remove();
    }
  }
  for (const anchor of fragment.querySelectorAll("a")) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    anchor.setAttribute("rel", "noopener noreferrer nofollow");
    anchor.setAttribute("target", "_blank");
  }
  const container = document.createElement("div");
  container.append(fragment);
  return container.innerHTML;
}
