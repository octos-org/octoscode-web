import { useRef, useState } from "react";
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
import { RequestAuthorityGate } from "../async/request-authority.ts";

interface BlockingInteractionDependencies {
  client: () => OctosUiClient | null;
  sessionId: () => string;
  capabilities: () => UiProtocolCapabilities | undefined;
  onInvalid: (title: string, body: string) => void;
}

export function useBlockingInteractions(
  dependencies: BlockingInteractionDependencies,
) {
  const decisionRequestsRef = useRef(new RequestAuthorityGate<OctosUiClient>());
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const approvalRef = useRef<ApprovalRequested | null>(null);
  const questionRef = useRef<UserQuestionRequested | null>(null);
  const [approval, setApproval] = useState<ApprovalRequested | null>(null);
  const [question, setQuestion] = useState<UserQuestionRequested | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    decisionRequestsRef.current.invalidate();
    approvalRef.current = null;
    questionRef.current = null;
    setApproval(null);
    setQuestion(null);
    setBusy(false);
    setError(null);
  };

  const restore = (
    hydrated: SessionHydrateResult,
    capabilities: UiProtocolCapabilities | undefined,
  ): { turnId: string | null; waiting: boolean } => {
    decisionRequestsRef.current.invalidate();
    const sessionId = dependenciesRef.current.sessionId();
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
    const restoredApproval = supportsMethod(
      capabilities,
      CORE_UI_METHODS.APPROVAL_RESPOND,
    )
      ? (pendingApproval ?? null)
      : null;
    const restoredQuestion =
      supportsMethod(capabilities, CORE_UI_METHODS.USER_QUESTION_RESPOND) &&
      supportsFeature(capabilities, CORE_UI_FEATURES.USER_QUESTION_V1)
        ? (pendingQuestion ?? null)
        : null;
    approvalRef.current = restoredApproval;
    questionRef.current = restoredQuestion;
    setApproval(restoredApproval);
    setQuestion(restoredQuestion);
    setBusy(false);
    setError(null);
    return {
      turnId: restoredApproval?.turnId ?? restoredQuestion?.turnId ?? null,
      waiting: Boolean(restoredApproval || restoredQuestion),
    };
  };

  const respondApproval = async (
    decision: ApprovalDecision,
    scope: ApprovalScope,
  ): Promise<void> => {
    const currentDependencies = dependenciesRef.current;
    const client = currentDependencies.client();
    const sessionId = currentDependencies.sessionId();
    const current = approvalRef.current;
    if (!client || !sessionId || !current || busy) return;
    const request = decisionRequestsRef.current.begin(client, sessionId);
    setBusy(true);
    setError(null);
    try {
      const result = await client.respondApproval({
        session_id: current.sessionId,
        approval_id: current.approvalId,
        decision,
        approval_scope: scope,
      });
      if (!requestIsCurrent()) return;
      if (!result.accepted) throw new Error("The server rejected the decision");
      if (approvalRef.current?.approvalId === current.approvalId) {
        approvalRef.current = null;
      }
      setApproval((pending) =>
        pending?.approvalId === current.approvalId ? null : pending,
      );
    } catch (reason) {
      if (!requestIsCurrent()) return;
      setError(errorMessage(reason));
    } finally {
      if (decisionRequestsRef.current.finish(request)) setBusy(false);
    }

    function requestIsCurrent(): boolean {
      const latest = dependenciesRef.current;
      return decisionRequestsRef.current.isCurrent(
        request,
        latest.client(),
        latest.sessionId(),
      );
    }
  };

  const respondQuestion = async (
    answers: UserQuestionAnswer[],
  ): Promise<void> => {
    const currentDependencies = dependenciesRef.current;
    const client = currentDependencies.client();
    const sessionId = currentDependencies.sessionId();
    const current = questionRef.current;
    if (!client || !sessionId || !current || busy) return;
    const request = decisionRequestsRef.current.begin(client, sessionId);
    setBusy(true);
    setError(null);
    try {
      const result = await client.respondUserQuestion({
        session_id: current.sessionId,
        question_id: current.questionId,
        answers,
      });
      if (!requestIsCurrent()) return;
      if (!result.accepted) throw new Error("The server rejected the answer");
      if (questionRef.current?.questionId === current.questionId) {
        questionRef.current = null;
      }
      setQuestion((pending) =>
        pending?.questionId === current.questionId ? null : pending,
      );
    } catch (reason) {
      if (!requestIsCurrent()) return;
      setError(errorMessage(reason));
    } finally {
      if (decisionRequestsRef.current.finish(request)) setBusy(false);
    }

    function requestIsCurrent(): boolean {
      const latest = dependenciesRef.current;
      return decisionRequestsRef.current.isCurrent(
        request,
        latest.client(),
        latest.sessionId(),
      );
    }
  };

  const observeNotification = (
    notification: RpcNotification,
  ): { turnId: string; waiting: boolean } | null => {
    const currentDependencies = dependenciesRef.current;
    const sessionId = currentDependencies.sessionId();
    const capabilities = currentDependencies.capabilities();
    let affectedTurnId: string | null = null;
    if (notification.method === CORE_UI_METHODS.APPROVAL_REQUESTED) {
      const requested = parseApprovalRequested(notification);
      if (
        requested &&
        matchesSessionScope(sessionId, requested.sessionId, requested.topic) &&
        supportsMethod(capabilities, CORE_UI_METHODS.APPROVAL_RESPOND)
      ) {
        decisionRequestsRef.current.invalidate();
        approvalRef.current = requested;
        affectedTurnId = requested.turnId;
        setBusy(false);
        setError(null);
        setApproval(requested);
      } else {
        currentDependencies.onInvalid(
          "Approval cannot be rendered",
          "The request was malformed, belonged to another session, or approval/respond was not negotiated.",
        );
      }
    }

    const resolvedApprovalId = approvalResolutionId(notification);
    if (resolvedApprovalId) {
      const pending = approvalRef.current;
      if (pending?.approvalId === resolvedApprovalId) {
        decisionRequestsRef.current.invalidate();
        approvalRef.current = null;
        affectedTurnId = pending.turnId;
        setBusy(false);
      }
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
        decisionRequestsRef.current.invalidate();
        questionRef.current = requested;
        affectedTurnId = requested.turnId;
        setBusy(false);
        setError(null);
        setQuestion(requested);
      } else {
        currentDependencies.onInvalid(
          "Question cannot be rendered",
          `The request was malformed, belonged to another session, or ${CORE_UI_FEATURES.USER_QUESTION_V1} was not negotiated.`,
        );
      }
    }
    return affectedTurnId
      ? {
          turnId: affectedTurnId,
          waiting: Boolean(
            approvalRef.current?.turnId === affectedTurnId ||
            questionRef.current?.turnId === affectedTurnId,
          ),
        }
      : null;
  };

  const settleTurn = (turnId: string) => {
    if (
      approvalRef.current?.turnId === turnId ||
      questionRef.current?.turnId === turnId
    ) {
      decisionRequestsRef.current.invalidate();
      setBusy(false);
      setError(null);
    }
    if (approvalRef.current?.turnId === turnId) approvalRef.current = null;
    if (questionRef.current?.turnId === turnId) questionRef.current = null;
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
