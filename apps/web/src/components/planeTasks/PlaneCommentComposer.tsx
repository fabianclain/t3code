import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { type EnvironmentId, type PlaneComment, PlaneUnavailableError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { planeEnvironment } from "~/state/plane";
import { useAtomCommand } from "~/state/use-atom-command";
import { planeConnectionErrorMessage } from "~/components/settings/PlaneConnectionSettings.logic";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { PlaneHtmlEditor } from "./PlaneHtmlEditor";
import { planeCommentHtmlIsEmpty } from "./planeTaskDraft";

export interface PlaneCommentComposerProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
  readonly taskId: string;
  /** The comment Plane stored, so the parent can show it without another fetch. */
  readonly onAdded: (comment: PlaneComment) => void;
  /** Reports a draft the user has not posted, so the parent can guard closing. */
  readonly onDirtyChange?: (dirty: boolean) => void;
  /** Reports a post in flight, so the parent can refuse to dismiss the draft. */
  readonly onPendingChange?: (pending: boolean) => void;
}

const isPlaneTimeout = Schema.is(PlaneUnavailableError);

interface CommentPostFailure {
  readonly message: string;
  /** A post that timed out may still have landed in Plane, so the outcome is unknown. */
  readonly timedOut: boolean;
}

/**
 * Write one comment on a Plane task.
 *
 * The comment is posted as the current user; there is no author to pick. A failed post keeps
 * the draft so the text is not lost, and only a confirmed success clears it.
 */
export function PlaneCommentComposer(props: PlaneCommentComposerProps) {
  const { environmentId, projectId, taskId, onAdded, onDirtyChange, onPendingChange } = props;
  const [html, setHtml] = useState("");
  const [posting, setPosting] = useState(false);
  const [failure, setFailure] = useState<CommentPostFailure | null>(null);

  const canComment = useAtomValue(planeEnvironment.addComment.permissionAtom(environmentId));
  const addComment = useAtomCommand(planeEnvironment.addComment, { reportFailure: false });
  const empty = planeCommentHtmlIsEmpty(html);
  const disabled = posting || !canComment;

  const handleChange = (next: string) => {
    setHtml(next);
    onDirtyChange?.(!planeCommentHtmlIsEmpty(next));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (posting || empty) return;
    setPosting(true);
    setFailure(null);
    onPendingChange?.(true);
    const result = await addComment({
      environmentId,
      input: { projectId, taskId, html: html.trim() },
    });
    setPosting(false);
    onPendingChange?.(false);
    if (result._tag === "Failure") {
      // The draft stays as it is. Nothing is retried behind the user's back.
      const error = squashAtomCommandFailure(result);
      setFailure({
        message: planeConnectionErrorMessage(error),
        timedOut: isPlaneTimeout(error) && error.reason === "timeout",
      });
      return;
    }
    setHtml("");
    onDirtyChange?.(false);
    onAdded(result.value);
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
      <PlaneHtmlEditor
        value={html}
        disabled={disabled}
        label="Comment"
        placeholder="Write a comment"
        onChange={handleChange}
      />

      {canComment ? null : (
        <Alert variant="warning">
          <AlertTitle>This connection cannot post comments</AlertTitle>
          <AlertDescription>
            The environment did not grant the tasks permission, so commenting is unavailable.
          </AlertDescription>
        </Alert>
      )}

      {failure === null ? null : (
        <Alert variant="error">
          <AlertTitle>Posting the comment failed</AlertTitle>
          <AlertDescription>
            {failure.message}
            {failure.timedOut ? (
              <span>
                Plane did not answer in time. The comment may still be in Plane, so check the task
                before trying again.
              </span>
            ) : null}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button disabled={disabled || empty} type="submit">
          {posting ? <Spinner /> : null}
          Comment
        </Button>
      </div>
    </form>
  );
}
