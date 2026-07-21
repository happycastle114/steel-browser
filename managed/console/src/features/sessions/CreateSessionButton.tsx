import { Plus } from "lucide-react"
import { useNavigate } from "react-router-dom"

import { useCreateSessionMutation } from "../../api/queries.js"
import { ManagedApiError, MutationCertainty } from "../../api/client.js"
import { useMutationGate } from "../../api/mutation-gate-context.js"
import { ResultKind } from "../../api/schema-integrations.js"
import { ActionButton, ButtonVariant } from "../../components/ActionButton.js"
import { InlineNotice } from "../../components/InlineNotice.js"
import { ConsoleState, NoticeTone } from "../../domain/vocabulary.js"

export function CreateSessionButton() {
  const create = useCreateSessionMutation()
  const gate = useMutationGate()
  const navigate = useNavigate()
  function start() {
    create.mutate(undefined, { onSuccess: (result) => {
      if (result.kind === ResultKind.SESSION) void navigate(`/sessions/${result.session.sessionId}`)
    } })
  }
  const uncertain = create.error instanceof ManagedApiError && create.error.mutationCertainty === MutationCertainty.INDETERMINATE
  return <div className="create-session-control"><ActionButton disabled={!gate.allowed} icon={Plus} label={uncertain ? "Retry same request" : "New session"} loadingLabel="Requesting" onClick={start} state={create.isPending ? ConsoleState.LOADING : ConsoleState.READY} variant={ButtonVariant.PRIMARY} />{create.data?.kind === ResultKind.ADMISSION ? <span aria-live="polite">Queued at position {create.data.admission.position ?? "reserved"}</span> : null}{create.isError ? <InlineNotice message={uncertain ? "The request outcome is unknown. Current manager state is being reconciled; a retry reuses the same idempotency key." : "The manager rejected the request. Refresh current capacity before starting another session."} title={uncertain ? "Session request needs reconciliation" : "Session request rejected"} tone={NoticeTone.ERROR} /> : null}</div>
}
