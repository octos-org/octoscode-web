import { useState } from "react";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
  approvalResolutionId,
  parseApprovalRequested,
  parseUserQuestionRequested,
  supportsFeature,
  supportsMethod,
  type ApprovalDecision,
  type ApprovalRequested,
  type ApprovalScope,
  type OctosUiClient,
  type RpcNotification,
  type SessionHydrateResult,
  type UiProtocolCapabilities,
  type UserQuestionAnswer,
  type UserQuestionRequested,
} from "@octos-org/octoscode-client";
import { matchesSessionScope } from "../session/scope.ts";

interface BlockingInteractionDependencies {
  client: () => OctosUiClient | null;
  sessionId: () => string;
  capabilities: () => UiProtocolCapabilities | undefined;
  onInvalid: (title: string, body: string) => void;
}

export function useBlockingInteractions(
  dependencies: BlockingInteractionDependencies,
) {
  const [approval, setApproval] = useState<ApprovalRequested | null>(null);
  const [question, setQuestion] = useState<UserQuestionRequested | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setApproval(null);
    setQuestion(null);
    setBusy(false);
    setError(null);
  };

  const restore = (
    hydrated: SessionHydrateResult,
    capabilities: UiProtocolCapabilities | undefined,
  ) => {
    const sessionId = dependencies.sessionId();
    const pendingApproval = (hydrated.pending_approvals ?? [])
      .map((params) =>
        parseApprovalRequested({
          jsonrpc: "2.0",
          method: CORE_UI_METHODS.APPROVAL_REQUESTED,
          params,
        }),
      )
      .find(
        (request) =>
          request &&
          matchesSessionScope(sessionId, request.sessionId, request.topic),
      );
    const pendingQuestion = (hydrated.pending_questions ?? [])
      .map((params) =>
        parseUserQuestionRequested({
          jsonrpc: "2.0",
          method: CORE_UI_METHODS.USER_QUESTION_REQUESTED,
          params,
        }),
      )
      .find(
        (request) =>
          request &&
          matchesSessionScope(sessionId, request.sessionId, request.topic),
      );
    setApproval(
      supportsMethod(capabilities, CORE_UI_METHODS.APPROVAL_RESPOND)
        ? (pendingApproval ?? null)
        : null,
    );
    setQuestion(
      supportsMethod(capabilities, CORE_UI_METHODS.USER_QUESTION_RESPOND) &&
        supportsFeature(capabilities, CORE_UI_FEATURES.USER_QUESTION_V1)
        ? (pendingQuestion ?? null)
        : null,
    );
    setBusy(false);
    setError(null);
  };

  const respondApproval = async (
    decision: ApprovalDecision,
    scope: ApprovalScope,
  ): Promise<void> => {
    const client = dependencies.client();
    const current = approval;
    if (!client || !current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.respondApproval({
        session_id: current.sessionId,
        approval_id: current.approvalId,
        decision,
        approval_scope: scope,
      });
      if (!result.accepted) throw new Error("The server rejected the decision");
      setApproval((pending) =>
        pending?.approvalId === current.approvalId ? null : pending,
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const respondQuestion = async (
    answers: UserQuestionAnswer[],
  ): Promise<void> => {
    const client = dependencies.client();
    const current = question;
    if (!client || !current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.respondUserQuestion({
        session_id: current.sessionId,
        question_id: current.questionId,
        answers,
      });
      if (!result.accepted) throw new Error("The server rejected the answer");
      setQuestion((pending) =>
        pending?.questionId === current.questionId ? null : pending,
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const observeNotification = (notification: RpcNotification) => {
    const sessionId = dependencies.sessionId();
    const capabilities = dependencies.capabilities();
    if (notification.method === CORE_UI_METHODS.APPROVAL_REQUESTED) {
      const requested = parseApprovalRequested(notification);
      if (
        requested &&
        matchesSessionScope(sessionId, requested.sessionId, requested.topic) &&
        supportsMethod(capabilities, CORE_UI_METHODS.APPROVAL_RESPOND)
      ) {
        setError(null);
        setApproval(requested);
      } else {
        dependencies.onInvalid(
          "Approval cannot be rendered",
          "The request was malformed, belonged to another session, or approval/respond was not negotiated.",
        );
      }
    }

    const resolvedApprovalId = approvalResolutionId(notification);
    if (resolvedApprovalId) {
      setApproval((pending) =>
        pending?.approvalId === resolvedApprovalId ? null : pending,
      );
    }

    if (notification.method === CORE_UI_METHODS.USER_QUESTION_REQUESTED) {
      const requested = parseUserQuestionRequested(notification);
      if (
        requested &&
        matchesSessionScope(sessionId, requested.sessionId, requested.topic) &&
        supportsMethod(capabilities, CORE_UI_METHODS.USER_QUESTION_RESPOND) &&
        supportsFeature(capabilities, CORE_UI_FEATURES.USER_QUESTION_V1)
      ) {
        setError(null);
        setQuestion(requested);
      } else {
        dependencies.onInvalid(
          "Question cannot be rendered",
          `The request was malformed, belonged to another session, or ${CORE_UI_FEATURES.USER_QUESTION_V1} was not negotiated.`,
        );
      }
    }
  };

  const settleTurn = (turnId: string) => {
    setApproval((pending) => (pending?.turnId === turnId ? null : pending));
    setQuestion((pending) => (pending?.turnId === turnId ? null : pending));
  };

  return {
    approval,
    question,
    busy,
    error,
    reset,
    restore,
    respondApproval,
    respondQuestion,
    observeNotification,
    settleTurn,
  };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
