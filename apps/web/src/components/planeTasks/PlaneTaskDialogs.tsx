import type {
  EnvironmentId,
  PlaneComment,
  PlaneProjectMetadata,
  PlaneTask,
} from "@t3tools/contracts";
import { useBlocker } from "@tanstack/react-router";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useStableCallback } from "~/hooks/useStableCallback";
import { PlaneCommentComposer } from "./PlaneCommentComposer";
import { PlaneTaskEditor } from "./PlaneTaskEditor";

/**
 * One open write session. Environment, project, task, and metadata are captured when the
 * session opens, so a temporary disconnect or a background refetch never re-targets a draft
 * at a different environment or task.
 */
type PlaneTaskDialogSession =
  | {
      readonly kind: "task";
      readonly environmentId: EnvironmentId;
      readonly projectId: string;
      readonly task: PlaneTask | null;
      readonly metadata: PlaneProjectMetadata;
    }
  | {
      readonly kind: "comment";
      readonly environmentId: EnvironmentId;
      readonly projectId: string;
      readonly taskId: string;
    };

interface OpenPlaneTaskEditorInput {
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
  /** The task to edit, or null to create one. */
  readonly task: PlaneTask | null;
  readonly metadata: PlaneProjectMetadata;
}

interface OpenPlaneCommentComposerInput {
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
  readonly taskId: string;
}

interface PlaneTaskDialogsApi {
  openTaskEditor: (input: OpenPlaneTaskEditorInput) => void;
  openCommentComposer: (input: OpenPlaneCommentComposerInput) => void;
}

const PlaneTaskDialogsContext = createContext<PlaneTaskDialogsApi | null>(null);

export function usePlaneTaskDialogs(): PlaneTaskDialogsApi {
  const api = useContext(PlaneTaskDialogsContext);
  if (api === null) {
    throw new Error("usePlaneTaskDialogs needs a PlaneTaskDialogsProvider above it.");
  }
  return api;
}

/**
 * Hosts the task editor and comment composer as modals above the tasks page, so the browse
 * body unmounting (a temporary disconnect, a project switch) never unmounts an open draft.
 * Every close path is guarded: escape/outside-click/route changes ask once, a write in
 * flight is never dismissible, and the editor confirms its own Cancel.
 */
export function PlaneTaskDialogsProvider(props: {
  /** Navigates to a created task at the environment and project its session captured. */
  readonly onSelectTask: (target: {
    readonly environmentId: EnvironmentId;
    readonly projectId: string;
    readonly taskId: string;
  }) => void;
  readonly children: ReactNode;
}) {
  const { onSelectTask, children } = props;
  const [session, setSession] = useState<PlaneTaskDialogSession | null>(null);
  const [askingDiscard, setAskingDiscard] = useState(false);
  // Mirror of pendingRef for render, so a route attempt during a write never offers a live
  // Discard button.
  const [pending, setPending] = useState(false);
  // Written only from editor/composer events, never in render, so guards cannot act on a
  // stale value when onSaved/onAdded navigate synchronously after clearing dirty state.
  const dirtyRef = useRef(false);
  const pendingRef = useRef(false);
  const hasUnsavedWork = () => dirtyRef.current || pendingRef.current;

  const blocker = useBlocker({
    shouldBlockFn: hasUnsavedWork,
    enableBeforeUnload: hasUnsavedWork,
    withResolver: true,
  });
  const blockerActive = blocker.status === "blocked";

  const closeSession = () => {
    dirtyRef.current = false;
    pendingRef.current = false;
    setPending(false);
    setAskingDiscard(false);
    setSession(null);
  };

  const requestClose = () => {
    // A write in flight cannot be dismissed; wait for it to settle.
    if (pendingRef.current) return;
    if (dirtyRef.current) {
      setAskingDiscard(true);
      return;
    }
    closeSession();
  };

  const handleDirtyChange = useStableCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  });

  const handlePendingChange = useStableCallback((value: boolean) => {
    pendingRef.current = value;
    setPending(value);
  });

  // The editor already asked before calling onCancel, so close without asking again.
  const discard = () => {
    if (pendingRef.current) return;
    if (blockerActive) blocker.proceed();
    closeSession();
  };

  const keepEditing = () => {
    if (blockerActive) blocker.reset();
    setAskingDiscard(false);
  };

  const handleSaved = useStableCallback((saved: PlaneTask) => {
    const target =
      session?.kind === "task" && session.task === null
        ? {
            environmentId: session.environmentId,
            projectId: session.projectId,
            taskId: saved.id,
          }
        : null;
    // A confirmed save ends a stale blocked route attempt with reset, never proceed, so the
    // router is not stuck and this handler's own navigation stays authoritative.
    if (blockerActive) blocker.reset();
    closeSession();
    if (target !== null) onSelectTask(target);
  });

  const handleCommentAdded = useStableCallback((_comment: PlaneComment) => {
    if (blockerActive) blocker.reset();
    closeSession();
    toastManager.add(stackedThreadToast({ type: "success", title: "Comment posted" }));
  });

  const api: PlaneTaskDialogsApi = {
    openTaskEditor: (input) => {
      dirtyRef.current = false;
      pendingRef.current = false;
      setPending(false);
      setAskingDiscard(false);
      setSession({ kind: "task", ...input });
    },
    openCommentComposer: (input) => {
      dirtyRef.current = false;
      pendingRef.current = false;
      setPending(false);
      setAskingDiscard(false);
      setSession({ kind: "comment", ...input });
    },
  };

  return (
    <PlaneTaskDialogsContext.Provider value={api}>
      {children}
      <Dialog
        open={session !== null}
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <DialogPopup className="flex h-[min(42rem,90vh)] w-[min(46rem,94vw)] min-w-80 flex-col overflow-hidden">
          {session?.kind === "task" ? (
            <>
              <DialogHeader>
                <DialogTitle>{session.task === null ? "New task" : "Edit task"}</DialogTitle>
                <DialogDescription>
                  Saves straight to the connected Plane project.
                </DialogDescription>
              </DialogHeader>
              <PlaneTaskEditor
                key={`task:${session.environmentId}:${session.projectId}:${session.task?.id ?? "new"}`}
                environmentId={session.environmentId}
                metadata={session.metadata}
                projectId={session.projectId}
                task={session.task}
                onCancel={closeSession}
                onDirtyChange={handleDirtyChange}
                onPendingChange={handlePendingChange}
                onSaved={handleSaved}
              />
            </>
          ) : session?.kind === "comment" ? (
            <>
              <DialogHeader>
                <DialogTitle>Add comment</DialogTitle>
                <DialogDescription>Posted as the connected Plane user.</DialogDescription>
              </DialogHeader>
              <DialogPanel>
                <PlaneCommentComposer
                  key={`comment:${session.environmentId}:${session.projectId}:${session.taskId}`}
                  environmentId={session.environmentId}
                  projectId={session.projectId}
                  taskId={session.taskId}
                  onAdded={handleCommentAdded}
                  onDirtyChange={handleDirtyChange}
                  onPendingChange={handlePendingChange}
                />
              </DialogPanel>
            </>
          ) : null}
        </DialogPopup>
      </Dialog>
      <AlertDialog
        open={askingDiscard || blockerActive}
        onOpenChange={(open) => {
          if (!open) keepEditing();
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard the unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              This draft has edits that were not saved to Plane. Discarding them cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Keep editing</AlertDialogClose>
            <Button variant="destructive" disabled={pending} onClick={discard}>
              Discard changes
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </PlaneTaskDialogsContext.Provider>
  );
}
