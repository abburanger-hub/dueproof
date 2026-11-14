import { useCallback, useRef, useState } from 'react'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import {
  getLocalOnlyModel,
  prepareDeviceModel,
} from '../../infrastructure/firebase/ai'
import type { GenerateContentRequest } from '../../infrastructure/firebase/ai'

/**
 * DEVELOPMENT-ONLY on-device inference spike (hackathon de-risking).
 *
 * This panel exists to answer one question with a real measurement: can this
 * machine run the Chrome on-device model through Firebase AI Logic with
 * `InferenceMode.ONLY_ON_DEVICE`, and does the response genuinely report
 * `inferenceSource: 'on_device'`?
 *
 * It is intentionally not part of the product. It sends no user evidence —
 * only fixed, synthetic prompts. It must never be reachable in a production
 * build (see App.tsx, which renders it only when `import.meta.env.DEV` is
 * true; Vite replaces that flag statically, so the panel is tree-shaken out
 * of production bundles).
 *
 * The flow matches the real Phase 4 pipeline the product will use:
 *   user gesture → prepareDeviceModel (download with progress) →
 *   ONLY_ON_DEVICE generateContent → read response.inferenceSource.
 */

type SpikePhase = 'idle' | 'preparing' | 'ready' | 'running' | 'done' | 'error'

interface SpikeLogEntry {
  at: string
  message: string
}

/**
 * Redacts user-irrelevant but identifying internals (UUIDs) from error text so
 * the log stays safe to copy into a bug report or paste back to a colleague.
 */
function sanitizeErrorText(text: string): string {
  return text.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    '[uuid]',
  )
}

/**
 * Extracts a short, readable reason from an unknown thrown value without
 * leaking long stack traces into the panel log.
 */
function toReason(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeErrorText(error.message)
  }
  if (typeof error === 'string') {
    return sanitizeErrorText(error)
  }
  return 'Unknown error'
}

export function AiSpikePanel() {
  const [phase, setPhase] = useState<SpikePhase>('idle')
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null)
  const [resultText, setResultText] = useState<string | null>(null)
  const [inferenceSource, setInferenceSource] = useState<string | null>(null)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const [log, setLog] = useState<SpikeLogEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  // Guards against double-invocation of the async flows from one click
  // (React event pooling + async state updates otherwise allow overlap).
  const busyRef = useRef(false)

  const appendLog = useCallback((message: string) => {
    const at = new Date().toLocaleTimeString()
    setLog((entries) => [...entries, { at, message }])
  }, [])

  const handlePrepare = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setPhase('preparing')
    setError(null)
    setResultText(null)
    setInferenceSource(null)
    setLatencyMs(null)
    setDownloadProgress(null)
    appendLog('Calling initializeDeviceModel() — requires a user gesture (this click).')

    try {
      const started = performance.now()
      await prepareDeviceModel((progressValue: number) => {
        setDownloadProgress(progressValue)
      })
      const elapsed = Math.round(performance.now() - started)
      setPhase('ready')
      appendLog(
        `On-device model ready in ${elapsed} ms. You can now run a local-only inference.`,
      )
      if (downloadNeedsRegistrationNote()) {
        appendLog(
          'Reminder: on the first app run with an AI feature, the browser console prints the App Check debug token — register it once in the Firebase console.',
        )
      }
    } catch (thrown) {
      setPhase('error')
      setError(toReason(thrown))
      appendLog(`prepareDeviceModel failed: ${toReason(thrown)}`)
    } finally {
      busyRef.current = false
    }
  }, [appendLog])

  const handleRunInference = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setPhase('running')
    setError(null)
    setResultText(null)
    setInferenceSource(null)
    setLatencyMs(null)

    // Fixed synthetic prompt — no user evidence, nothing private.
    // The installed SDK's `Part` type requires an explicit `type: 'text'`
    // discriminant on TextPart (verified against @firebase/ai 13.3.0 types).
    const request: GenerateContentRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ type: 'text', text: 'Reply with exactly: DUEPROOF_ON_DEVICE_OK' }],
        },
      ],
    }

    try {
      const model = await getLocalOnlyModel()
      const started = performance.now()
      const result = await model.generateContent(request)
      const elapsed = Math.round(performance.now() - started)

      const text = result.response.text()
      const source = result.response.inferenceSource ?? 'unreported'
      setResultText(text)
      setInferenceSource(source)
      setLatencyMs(elapsed)
      setPhase('done')
      appendLog(
        `generateContent returned in ${elapsed} ms; inferenceSource="${source}".`,
      )
      if (source !== 'on_device') {
        appendLog(
          'WARNING: inferenceSource is not "on_device" — the ONLY_ON_DEVICE contract may have been violated. This must be investigated before building Phase 4.',
        )
      }
    } catch (thrown) {
      setPhase('error')
      setError(toReason(thrown))
      appendLog(`Local-only inference failed: ${toReason(thrown)}`)
    } finally {
      busyRef.current = false
    }
  }, [appendLog])

  return (
    <section
      aria-labelledby="ai-spike-heading"
      className="rounded-lg border border-line bg-surface p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Development-only panel
          </p>
          <h2 id="ai-spike-heading" className="mt-1 text-lg font-semibold text-slate-900">
            On-device inference spike
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-600">
            Verifies the privacy boundary end-to-end: model preparation, a
            real <code className="rounded bg-surface-inset px-1 py-0.5 text-xs">ONLY_ON_DEVICE</code>{' '}
            call, and the SDK-reported inference source. Uses a fixed synthetic
            prompt — no evidence is processed.
          </p>
        </div>
        <Badge tone="caution">Dev only</Badge>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          onClick={handlePrepare}
          disabled={phase === 'preparing' || phase === 'ready'}
        >
          {phase === 'ready' ? 'Model prepared' : 'Prepare on-device model'}
        </Button>
        <Button
          variant="secondary"
          onClick={handleRunInference}
          disabled={phase !== 'ready'}
        >
          Run local-only inference
        </Button>
      </div>

      {downloadProgress !== null && phase === 'preparing' && (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-500">
            Model download progress: {Math.round(downloadProgress * 100)}%
          </p>
          <div
            className="mt-1 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-surface-inset"
            role="progressbar"
            aria-valuenow={Math.round(downloadProgress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="On-device model download progress"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${Math.round(downloadProgress * 100)}%` }}
            />
          </div>
        </div>
      )}

      {phase === 'running' && (
        <p className="mt-4 text-sm text-slate-500" aria-live="polite">
          Running local-only inference…
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
          {error}
        </p>
      )}

      {(phase === 'done' || inferenceSource) && (
        <div className="mt-4 grid gap-3 rounded-md border border-line bg-surface-muted p-4 sm:grid-cols-[auto_1fr]">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Result
          </div>
          <div className="grid gap-2 text-sm text-slate-700">
            {inferenceSource && (
              <p>
                <span className="font-semibold">Inference source:</span>{' '}
                <code className="rounded bg-surface-inset px-1 py-0.5 text-xs">
                  {inferenceSource}
                </code>{' '}
                {inferenceSource === 'on_device' ? (
                  <Badge tone="positive">Verified on-device</Badge>
                ) : (
                  <Badge tone="caution">Unexpected source</Badge>
                )}
              </p>
            )}
            {latencyMs !== null && (
              <p>
                <span className="font-semibold">Latency:</span> {latencyMs} ms
              </p>
            )}
            {resultText && (
              <p>
                <span className="font-semibold">Output:</span>{' '}
                <code className="rounded bg-surface-inset px-1 py-0.5 text-xs">
                  {resultText}
                </code>
              </p>
            )}
          </div>
        </div>
      )}

      {log.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Activity log
          </p>
          <ul className="mt-2 space-y-1 text-xs text-slate-500">
            {log.map((entry) => (
              <li key={`${entry.at}-${entry.message}`}>
                <span className="font-mono">{entry.at}</span> — {entry.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/**
 * The App Check debug token registration reminder matters only on the very
 * first AI run of a browser profile. Keeping it in the log (rather than a
 * modal) keeps this dev panel quiet while still surfacing the step.
 */
function downloadNeedsRegistrationNote(): boolean {
  return true
}
