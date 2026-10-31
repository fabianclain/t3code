import DOMPurify from "dompurify";
import { describe, expect, it } from "vite-plus/test";
import { analyzePlaneHtml, sanitizePlaneHtml } from "./planeHtml";

describe("analyzePlaneHtml", () => {
  it.each([
    ["plain text", "<p>Ship it</p>", []],
    ["inline marks", "<p><strong>bold</strong> and <em>italic</em></p>", []],
    ["lists", "<ul><li>one</li><li>two</li></ul>", []],
    ["code blocks", "<pre><code>const a = 1;</code></pre>", []],
    ["links", '<p><a href="https://example.com" rel="noreferrer">docs</a></p>', []],
    ["plain wrappers", "<div><span>text</span></div>", []],
    ["tables", "<table><tbody><tr><td>a</td></tr></tbody></table>", ["tables"]],
    ["images", '<img src="https://example.com/a.png" alt="a" />', ["images"]],
    [
      "mentions",
      '<span data-type="mention" data-id="7">@ada</span>',
      ["data-type metadata", "data-id metadata"],
    ],
    ["classed wrappers", '<span class="mention">@ada</span>', ["class attributes"]],
    ["inline styles", '<p style="color: red">red</p>', ["inline styles"]],
    ["unknown attributes", '<p id="lead">text</p>', ["id attributes"]],
    ["accessibility attributes", '<p aria-label="lead">text</p>', ["accessibility attributes"]],
    ["semantic wrappers", "<section>text</section>", ["content sections"]],
    ["comments", "<p>text</p><!-- note -->", ["HTML comments"]],
  ])("classifies %s", (_label, html, expected) => {
    expect(analyzePlaneHtml(html).unsupported).toEqual(expected);
  });
});

describe("sanitizePlaneHtml", () => {
  it("escapes the source when the sanitizer has no DOM", () => {
    // The unit project runs without a DOM, so the sanitizer cannot build a tree.
    expect(DOMPurify.isSupported).toBe(false);
    expect(sanitizePlaneHtml('<p>Hi</p><script>alert("x")</script>')).toBe(
      "&lt;p&gt;Hi&lt;/p&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });
});
