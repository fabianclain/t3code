import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  BoldIcon,
  CodeIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  Redo2Icon,
  StrikethroughIcon,
  Undo2Icon,
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { Toggle } from "~/components/ui/toggle";
import { useStableCallback } from "~/hooks/useStableCallback";
import { cn } from "~/lib/utils";
import { PLANE_HTML_CONTENT_CLASS, analyzePlaneHtml, sanitizePlaneHtml } from "./planeHtml";

const EDITOR_EXTENSIONS = [
  StarterKit.configure({
    link: {
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      defaultProtocol: "https",
      HTMLAttributes: { rel: "noopener noreferrer nofollow" },
    },
    trailingNode: false,
  }),
];

const EDITOR_CONTENT_CLASS = cn(PLANE_HTML_CONTENT_CLASS, "min-h-24 px-3 py-2 focus:outline-none");

export interface PlaneHtmlEditorProps {
  /** The HTML to edit. The parent owns the draft and every change to it. */
  readonly value: string;
  readonly onChange: (html: string) => void;
  readonly disabled?: boolean;
  readonly label: string;
  readonly placeholder?: string;
}

interface PlaneRichEditorProps {
  readonly value: string;
  readonly onChange: (html: string) => void;
  readonly disabled: boolean;
  readonly placeholder: string | undefined;
  readonly labelId: string;
}

interface PlaneEditorState {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly strike: boolean;
  readonly code: boolean;
  readonly bulletList: boolean;
  readonly orderedList: boolean;
  readonly blockquote: boolean;
  readonly link: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly isEmpty: boolean;
}

function readEditorState(current: Editor): PlaneEditorState {
  return {
    bold: current.isActive("bold"),
    italic: current.isActive("italic"),
    strike: current.isActive("strike"),
    code: current.isActive("code"),
    bulletList: current.isActive("bulletList"),
    orderedList: current.isActive("orderedList"),
    blockquote: current.isActive("blockquote"),
    link: current.isActive("link"),
    canUndo: current.can().undo(),
    canRedo: current.can().redo(),
    isEmpty: current.isEmpty,
  };
}

function PlaneEditorToolbar(props: {
  readonly editor: Editor;
  readonly state: PlaneEditorState;
  readonly disabled: boolean;
  readonly onEditLink: () => void;
}) {
  const { editor, state, disabled, onEditLink } = props;
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border/60 px-1 py-1">
      <Toggle
        variant="ghost"
        size="xs"
        pressed={state.bold}
        disabled={disabled}
        aria-label="Bold"
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <BoldIcon />
      </Toggle>
      <Toggle
        variant="ghost"
        size="xs"
        pressed={state.italic}
        disabled={disabled}
        aria-label="Italic"
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <ItalicIcon />
      </Toggle>
      <Toggle
        variant="ghost"
        size="xs"
        pressed={state.strike}
        disabled={disabled}
        aria-label="Strikethrough"
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <StrikethroughIcon />
      </Toggle>
      <Toggle
        variant="ghost"
        size="xs"
        pressed={state.code}
        disabled={disabled}
        aria-label="Inline code"
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <CodeIcon />
      </Toggle>
      <Toggle
        variant="ghost"
        size="xs"
        pressed={state.bulletList}
        disabled={disabled}
        aria-label="Bulleted list"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <ListIcon />
      </Toggle>
      <Toggle
        variant="ghost"
        size="xs"
        pressed={state.orderedList}
        disabled={disabled}
        aria-label="Numbered list"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrderedIcon />
      </Toggle>
      <Toggle
        variant="ghost"
        size="xs"
        pressed={state.blockquote}
        disabled={disabled}
        aria-label="Quote"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <QuoteIcon />
      </Toggle>
      <Toggle
        variant="ghost"
        size="xs"
        pressed={state.link}
        disabled={disabled}
        aria-label="Link"
        onClick={onEditLink}
      >
        <LinkIcon />
      </Toggle>
      <span className="mx-1 h-4 w-px bg-border" />
      <Toggle
        variant="ghost"
        size="xs"
        disabled={disabled || !state.canUndo}
        aria-label="Undo"
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2Icon />
      </Toggle>
      <Toggle
        variant="ghost"
        size="xs"
        disabled={disabled || !state.canRedo}
        aria-label="Redo"
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2Icon />
      </Toggle>
    </div>
  );
}

function PlaneRichEditor(props: PlaneRichEditorProps) {
  const { value, onChange, disabled, placeholder, labelId } = props;
  const emitChange = useStableCallback(onChange);
  const [initialContent] = useState(() => sanitizePlaneHtml(value));
  const [editorProps] = useState(() => ({
    attributes: {
      class: EDITOR_CONTENT_CLASS,
      role: "textbox",
      "aria-multiline": "true",
      "aria-labelledby": labelId,
    },
  }));
  const loadedValueRef = useRef(value);
  const lastEmittedRef = useRef<string | null>(null);

  const editor = useEditor(
    {
      extensions: EDITOR_EXTENSIONS,
      content: initialContent,
      editable: !disabled,
      editorProps,
      onUpdate: ({ editor: updated }) => {
        const html = updated.isEmpty ? "" : updated.getHTML();
        if (html === lastEmittedRef.current) return;
        lastEmittedRef.current = html;
        emitChange(html);
      },
    },
    [],
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the Tiptap document in step with the controlled value
  useLayoutEffect(() => {
    if (!editor) return;
    if (value === loadedValueRef.current) return;
    loadedValueRef.current = value;
    if (value === lastEmittedRef.current) return;
    editor.commands.setContent(sanitizePlaneHtml(value), { emitUpdate: false });
  }, [editor, value]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the Tiptap view editable state in step with the disabled prop
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [disabled, editor]);

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => readEditorState(current),
  });

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState("");

  // A parent save disables the editor while it runs; the command must not touch
  // the document then, or the saved value would drop the edit.
  const applyLink = useStableCallback(() => {
    if (disabled) return;
    const href = linkHref.trim();
    if (href.length === 0) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    setLinkOpen(false);
  });

  return (
    <div className="overflow-hidden rounded-lg border border-input bg-background">
      <PlaneEditorToolbar
        editor={editor}
        state={state}
        disabled={disabled}
        onEditLink={() => {
          setLinkHref(String(editor.getAttributes("link").href ?? ""));
          setLinkOpen(true);
        }}
      />
      {linkOpen ? (
        <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
          <Input
            size="sm"
            value={linkHref}
            autoFocus
            disabled={disabled}
            placeholder="https://example.com"
            aria-label="Link address"
            onValueChange={(next) => setLinkHref(next)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setLinkOpen(false);
              }
            }}
          />
          <Button size="xs" variant="secondary" disabled={disabled} onClick={applyLink}>
            Apply
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setLinkOpen(false)}>
            Cancel
          </Button>
        </div>
      ) : null}
      <div className="relative">
        <EditorContent editor={editor} />
        {placeholder && state.isEmpty ? (
          <p className="pointer-events-none absolute top-2 left-3 text-sm text-muted-foreground">
            {placeholder}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PlaneSourceEditor(props: {
  readonly value: string;
  readonly onChange: (html: string) => void;
  readonly disabled: boolean;
  readonly labelId: string;
}) {
  const { value, onChange, disabled, labelId } = props;
  return (
    <div className="[&_textarea]:font-mono [&_textarea]:text-xs">
      <Textarea
        value={value}
        disabled={disabled}
        aria-labelledby={labelId}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/**
 * Edit the HTML Plane stores for a task description or comment.
 *
 * A document using formatting the editor cannot represent opens as HTML source so
 * nothing is dropped; the reader can still choose the visual editor explicitly.
 */
export function PlaneHtmlEditor(props: PlaneHtmlEditorProps) {
  const { value, onChange, disabled = false, label, placeholder } = props;
  const labelId = useId();
  const unsupported = analyzePlaneHtml(value).unsupported;
  const [mode, setMode] = useState<"rich" | "source">("rich");
  const [acceptedValue, setAcceptedValue] = useState<string | null>(null);

  const richAllowed = unsupported.length === 0 || acceptedValue === value;
  const effectiveMode = richAllowed ? mode : "source";

  const switchToVisualEditor = () => {
    setAcceptedValue(value);
    setMode("rich");
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label id={labelId}>{label}</Label>
        <Button
          size="xs"
          variant="ghost"
          disabled={disabled}
          onClick={() => (effectiveMode === "rich" ? setMode("source") : switchToVisualEditor())}
        >
          {effectiveMode === "rich" ? "HTML source" : "Visual editor"}
        </Button>
      </div>
      {unsupported.length > 0 ? (
        <Alert variant="warning">
          <AlertTitle>Formatting the visual editor cannot keep</AlertTitle>
          <AlertDescription>
            <p>
              {effectiveMode === "rich"
                ? `Saving from the visual editor drops ${unsupported.join(", ")} from this description.`
                : `The visual editor cannot keep ${unsupported.join(", ")}. This description is open as HTML source so nothing is lost.`}
            </p>
            <Button
              size="xs"
              variant="outline"
              disabled={disabled}
              onClick={() =>
                effectiveMode === "rich" ? setMode("source") : switchToVisualEditor()
              }
            >
              {effectiveMode === "rich" ? "Edit as HTML source" : "Use the visual editor"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {effectiveMode === "rich" ? (
        <PlaneRichEditor
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder}
          labelId={labelId}
        />
      ) : (
        <PlaneSourceEditor
          value={value}
          onChange={onChange}
          disabled={disabled}
          labelId={labelId}
        />
      )}
    </div>
  );
}
