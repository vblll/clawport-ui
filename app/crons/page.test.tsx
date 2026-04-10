// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('@/app/agents-provider', () => ({
  useAgentsContext: () => ({
    agents: [{ id: 'jarvis', name: 'Jarvis' }],
  }),
}))

vi.mock('@/components/ErrorState', () => ({
  ErrorState: ({ message }: { message: string }) => <div>{message}</div>,
}))

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
}))

vi.mock('@/components/crons/WeeklySchedule', () => ({
  WeeklySchedule: () => <div>WeeklySchedule</div>,
}))

vi.mock('@/components/crons/PipelineGraph', () => ({
  PipelineGraph: () => <div>PipelineGraph</div>,
}))

vi.mock('@/components/crons/PipelineDetailPanel', () => ({
  PipelineDetailPanel: () => null,
}))

vi.mock('@/components/crons/PipelineWizard', () => ({
  PipelineWizard: () => null,
}))

import CronsPage from './page'

const BASE_CRON = {
  id: 'cron-1',
  name: 'jarvis-morning-brief',
  schedule: '0 7 * * *',
  scheduleDescription: 'Daily at 7 AM',
  timezone: null,
  status: 'ok' as const,
  lastRun: null,
  nextRun: null,
  lastError: null,
  agentId: 'jarvis',
  description: 'Original description',
  enabled: true,
  delivery: null,
  payload: {
    kind: 'isolated',
    lightContext: true,
    message: [
      'First paragraph of a long prompt.',
      '',
      'Second paragraph adds more detail.',
      '',
      'Closing instructions stay hidden in preview mode.',
    ].join('\n'),
    timeoutSeconds: 600,
  },
  lastDurationMs: null,
  consecutiveErrors: 0,
  lastDeliveryStatus: null,
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('CronsPage payload inline edit', () => {
  let currentCron = structuredClone(BASE_CRON)
  let saveError: string | null = null
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    currentCron = structuredClone(BASE_CRON)
    saveError = null
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url === '/api/crons' && (!init?.method || init.method === 'GET')) {
        return jsonResponse({ crons: [currentCron], pipelines: [] })
      }

      if (url === '/api/crons' && init?.method === 'PUT') {
        if (saveError) {
          return jsonResponse({ error: saveError }, 503)
        }

        const body = JSON.parse(String(init.body))
        currentCron = {
          ...currentCron,
          description: body.description,
          payload: {
            ...currentCron.payload,
            message: body.message,
            timeoutSeconds: body.timeoutSeconds,
          },
        }

        return jsonResponse({ ok: true, job: currentCron })
      }

      if (url.startsWith('/api/cron-runs')) {
        return jsonResponse([])
      }

      return jsonResponse({ error: `Unhandled fetch: ${url}` }, 404)
    })

    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  async function renderAndExpand() {
    render(<CronsPage />)
    await waitFor(() => {
      expect(screen.getByText('jarvis-morning-brief')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /jarvis-morning-brief/i }))
  }

  it('shows description, message preview, timeout, and expands the message', async () => {
    await renderAndExpand()

    expect(screen.getByText('Description')).toBeTruthy()
    expect(screen.getByText('Original description')).toBeTruthy()
    expect(screen.getByText('Timeout')).toBeTruthy()
    expect(screen.getByText(/600/)).toBeTruthy()
    expect(screen.getByText(/First paragraph of a long prompt/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /show more/i })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /show more/i }))

    expect(screen.getByText(/Closing instructions stay hidden in preview mode/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /show less/i })).toBeTruthy()
  })

  it('enters edit mode with current values and cancel discards unsaved changes', async () => {
    await renderAndExpand()

    fireEvent.click(screen.getByRole('button', { name: /edit payload/i }))

    const descriptionInput = screen.getByLabelText('Description')
    const messageInput = screen.getByLabelText('Message')
    const timeoutInput = screen.getByLabelText('Timeout')

    fireEvent.change(descriptionInput, { target: { value: 'Changed description' } })
    fireEvent.change(messageInput, { target: { value: 'Changed message' } })
    fireEvent.change(timeoutInput, { target: { value: '900' } })
    fireEvent.click(screen.getByRole('button', { name: /cancel edit/i }))

    expect(screen.queryByDisplayValue('Changed description')).toBeNull()
    expect(screen.queryByDisplayValue('Changed message')).toBeNull()
    expect(screen.getByText('Original description')).toBeTruthy()
    expect(screen.getByText(/First paragraph of a long prompt/)).toBeTruthy()
  })

  it('saves inline edits and updates the rendered values', async () => {
    await renderAndExpand()

    fireEvent.click(screen.getByRole('button', { name: /edit payload/i }))
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Updated description' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Updated prompt body' } })
    fireEvent.change(screen.getByLabelText('Timeout'), { target: { value: '900' } })
    fireEvent.click(screen.getByRole('button', { name: /save payload/i }))

    await waitFor(() => {
      expect(screen.getByText('Updated description')).toBeTruthy()
    })

    expect(screen.getByText(/Updated prompt body/)).toBeTruthy()
    expect(screen.getByText(/900/)).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/crons',
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  it('preserves dirty form values and shows error text when save fails', async () => {
    saveError = 'Gateway unavailable while editing cron job.'

    await renderAndExpand()

    fireEvent.click(screen.getByRole('button', { name: /edit payload/i }))
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Unsaved draft message' } })
    fireEvent.click(screen.getByRole('button', { name: /save payload/i }))

    await waitFor(() => {
      expect(screen.getByText(/Gateway unavailable while editing cron job/)).toBeTruthy()
    })

    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('Unsaved draft message')
  })
})
