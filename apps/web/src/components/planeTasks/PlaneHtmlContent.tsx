import { PLANE_HTML_CONTENT_CLASS, sanitizePlaneHtml } from "./planeHtml";

export interface PlaneHtmlContentProps {
  /** The HTML stored by Plane. */
  readonly html: string;
  /** Shown when the task has no description; nothing is rendered without it. */
  readonly emptyText?: string;
}

/**
 * Render Plane HTML for reading.
 *
 * Remote markup is reduced to a bounded tag and attribute allowlist first: no
 * scripts, handlers, unsafe links, inline styles or remote CSS classes reach the DOM.
 */
export function PlaneHtmlContent({ html, emptyText }: PlaneHtmlContentProps) {
  if (html.trim().length === 0) {
    if (!emptyText) return null;
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <div
      className={PLANE_HTML_CONTENT_CLASS}
      data-slot="plane-html-content"
      dangerouslySetInnerHTML={{ __html: sanitizePlaneHtml(html) }}
    />
  );
}
