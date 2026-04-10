// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecFileSync, mockGetCrons, mockClearCronsCache, mockDetectOpenClawBin } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockGetCrons: vi.fn(),
  mockClearCronsCache: vi.fn(),
  mockDetectOpenClawBin: vi.fn(),
}))

vi.mock('child_process', () => ({
  execFileSync: mockExecFileSync,
}))

vi.mock('@/lib/crons', () => ({
  getCrons: mockGetCrons,
  clearCronsCache: mockClearCronsCache,
}))

vi.mock('@/lib/setup-detection', () => ({
  detectOpenClawBin: mockDetectOpenClawBin,
}))

import { PUT } from './route'

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/crons', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PUT /api/crons', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('OPENCLAW_BIN', '/usr/local/bin/openclaw')
    mockDetectOpenClawBin.mockReturnValue('/opt/homebrew/bin/openclaw')
  })

  it('rejects invalid jobId', async () => {
    const response = await PUT(makeRequest({
      jobId: '   ',
      description: 'desc',
      message: 'message',
      timeoutSeconds: 300,
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining('jobId'),
    })
  })

  it('rejects non-string message', async () => {
    const response = await PUT(makeRequest({
      jobId: 'job-1',
      description: 'desc',
      message: 42,
      timeoutSeconds: 300,
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Message must be a string',
    })
  })

  it('rejects invalid timeoutSeconds', async () => {
    const response = await PUT(makeRequest({
      jobId: 'job-1',
      description: 'desc',
      message: 'message',
      timeoutSeconds: 0,
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Timeout must be a positive integer',
    })
  })

  it('invokes OpenClaw edit for changed fields only', async () => {
    mockGetCrons
      .mockResolvedValueOnce([{
        id: 'job-1',
        name: 'jarvis-morning-brief',
        schedule: '0 7 * * *',
        scheduleDescription: 'Daily at 7 AM',
        timezone: null,
        status: 'ok',
        lastRun: null,
        nextRun: null,
        lastError: null,
        agentId: 'jarvis',
        description: 'Existing description',
        enabled: true,
        delivery: null,
        payload: {
          kind: 'isolated',
          lightContext: true,
          message: 'Current prompt',
          timeoutSeconds: 600,
        },
        lastDurationMs: null,
        consecutiveErrors: 0,
        lastDeliveryStatus: null,
      }])
      .mockResolvedValueOnce([{
        id: 'job-1',
        name: 'jarvis-morning-brief',
        schedule: '0 7 * * *',
        scheduleDescription: 'Daily at 7 AM',
        timezone: null,
        status: 'ok',
        lastRun: null,
        nextRun: null,
        lastError: null,
        agentId: 'jarvis',
        description: 'Existing description',
        enabled: true,
        delivery: null,
        payload: {
          kind: 'isolated',
          lightContext: true,
          message: 'Updated prompt',
          timeoutSeconds: 900,
        },
        lastDurationMs: null,
        consecutiveErrors: 0,
        lastDeliveryStatus: null,
      }])

    const response = await PUT(makeRequest({
      jobId: 'job-1',
      description: 'Existing description',
      message: 'Updated prompt',
      timeoutSeconds: 900,
    }))

    expect(mockExecFileSync).toHaveBeenCalledWith(
      '/usr/local/bin/openclaw',
      ['cron', 'edit', 'job-1', '--message', 'Updated prompt', '--timeout-seconds', '900'],
      expect.objectContaining({
        encoding: 'utf-8',
        timeout: 15000,
      }),
    )
    expect(mockClearCronsCache).toHaveBeenCalled()
    expect(response.status).toBe(200)
  })

  it('returns updated cron data on success', async () => {
    mockGetCrons
      .mockResolvedValueOnce([{
        id: 'job-1',
        name: 'jarvis-morning-brief',
        schedule: '0 7 * * *',
        scheduleDescription: 'Daily at 7 AM',
        timezone: null,
        status: 'ok',
        lastRun: null,
        nextRun: null,
        lastError: null,
        agentId: 'jarvis',
        description: 'Old description',
        enabled: true,
        delivery: null,
        payload: {
          kind: 'isolated',
          lightContext: true,
          message: 'Old prompt',
          timeoutSeconds: 600,
        },
        lastDurationMs: null,
        consecutiveErrors: 0,
        lastDeliveryStatus: null,
      }])
      .mockResolvedValueOnce([{
        id: 'job-1',
        name: 'jarvis-morning-brief',
        schedule: '0 7 * * *',
        scheduleDescription: 'Daily at 7 AM',
        timezone: null,
        status: 'ok',
        lastRun: null,
        nextRun: null,
        lastError: null,
        agentId: 'jarvis',
        description: 'New description',
        enabled: true,
        delivery: null,
        payload: {
          kind: 'isolated',
          lightContext: true,
          message: 'New prompt',
          timeoutSeconds: 1200,
        },
        lastDurationMs: null,
        consecutiveErrors: 0,
        lastDeliveryStatus: null,
      }])

    const response = await PUT(makeRequest({
      jobId: 'job-1',
      description: 'New description',
      message: 'New prompt',
      timeoutSeconds: 1200,
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      job: expect.objectContaining({
        id: 'job-1',
        description: 'New description',
        payload: expect.objectContaining({
          message: 'New prompt',
          timeoutSeconds: 1200,
        }),
      }),
      ok: true,
    })
  })

  it('returns clear error on gateway failure', async () => {
    mockGetCrons.mockResolvedValue([{
      id: 'job-1',
      name: 'jarvis-morning-brief',
      schedule: '0 7 * * *',
      scheduleDescription: 'Daily at 7 AM',
      timezone: null,
      status: 'ok',
      lastRun: null,
      nextRun: null,
      lastError: null,
      agentId: 'jarvis',
      description: 'Old description',
      enabled: true,
      delivery: null,
      payload: {
        kind: 'isolated',
        lightContext: true,
        message: 'Old prompt',
        timeoutSeconds: 600,
      },
      lastDurationMs: null,
      consecutiveErrors: 0,
      lastDeliveryStatus: null,
    }])
    mockExecFileSync.mockImplementation(() => {
      throw new Error('gateway closed (1006 abnormal closure (no close frame)): no close reason')
    })

    const response = await PUT(makeRequest({
      jobId: 'job-1',
      description: 'Old description',
      message: 'New prompt',
      timeoutSeconds: 600,
    }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining('Gateway unavailable'),
    })
  })
})
