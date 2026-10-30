import DOMPurify from "dompurify";

const NAVIGATION_TAGS = [
  "a",
  "area",
  "base",
  "form",
  "iframe",
  "link",
  "meta",
  "object",
  "embed",
];
const URL_ATTRIBUTES = [
  "action",
  "background",
  "data",
  "formaction",
  "href",
  "ping",
  "poster",
  "srcset",
  "target",
  "xlink:href",
];

/**
 * CSP does not block a sandboxed frame's own link navigation. Remove every
 * navigation/subresource URL before srcdoc parsing, not only script elements.
 */
export function sanitizeSandboxMarkup(
  source: string,
  profile: "html" | "svg" = "html",
): string {
  const sanitized = DOMPurify.sanitize(source, {
    USE_PROFILES: { [profile]: true },
    FORBID_TAGS: [
      ...NAVIGATION_TAGS,
      "style",
      "script",
      "input",
      "button",
      "foreignObject",
      "math",
    ],
    FORBID_ATTR: ["style", ...URL_ATTRIBUTES],
  });
  const document = new DOMParser().parseFromString(sanitized, "text/html");
  for (const element of document.querySelectorAll("[src]")) {
    const value = element.getAttribute("src") ?? "";
    if (
      element.localName !== "img" ||
      !/^data:image\/(?:png|gif|jpe?g|webp);base64,/i.test(value)
    ) {
      element.removeAttribute("src");
    }
  }
  return document.body.innerHTML;
}
