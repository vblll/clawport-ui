import { clearCronsCache, getCrons } from '@/lib/crons'
import { loadPipelines } from '@/lib/cron-pipelines.server'
import { apiErrorResponse } from '@/lib/api-error'
import { detectOpenClawBin } from '@/lib/setup-detection'
import { execFileSync } from 'child_process'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const crons = await getCrons()
    const pipelines = loadPipelines()
    return NextResponse.json({ crons, pipelines })
  } catch (err) {
    return apiErrorResponse(err, 'Failed to load cron jobs')
  }
}

class CronUpdateError extends Error {
  status: number

  constructor(message: string, status = 500) {
    super(message)
    this.name = 'CronUpdateError'
    this.status = status
  }
}

interface CronUpdateBody {
  jobId: string
  description: string
  message: string
  timeoutSeconds: number
}

function readExecError(err: unknown): string {
  if (!(err instanceof Error)) return 'Failed to update cron job'

  const execErr = err as NodeJS.ErrnoException & {
    stdout?: string | Buffer
    stderr?: string | Buffer
  }

  const stdout = typeof execErr.stdout === 'string'
    ? execErr.stdout
    : Buffer.isBuffer(execErr.stdout)
      ? execErr.stdout.toString('utf-8')
      : ''
  const stderr = typeof execErr.stderr === 'string'
    ? execErr.stderr
    : Buffer.isBuffer(execErr.stderr)
      ? execErr.stderr.toString('utf-8')
      : ''

  return [stderr, stdout, err.message].filter(Boolean).join('\n').trim() || 'Failed to update cron job'
}

function mapCronUpdateError(err: unknown): CronUpdateError {
  const message = readExecError(err)
  const unsupportedFlag = message.match(/unknown (?:option|argument).*?(--[a-z-]+)/i)

  if (unsupportedFlag) {
    return new CronUpdateError(
      `Installed OpenClaw CLI does not support cron edit flag ${unsupportedFlag[1]}. Upgrade OpenClaw or remove that field from the edit.`,
      501,
    )
  }

  if (/gateway closed|connect ECONN|ECONNREFUSED|EHOSTUNREACH|Gateway target:/i.test(message)) {
    return new CronUpdateError(
      `Gateway unavailable while editing cron job. ${message}`,
      503,
    )
  }

  return new CronUpdateError(message, 502)
}

function validateCronUpdateBody(body: unknown): CronUpdateBody {
  const input = body as Record<string, unknown>
  const jobId = typeof input.jobId === 'string' ? input.jobId.trim() : ''

  if (!jobId || /[\r\n]/.test(jobId)) {
    throw new CronUpdateError('jobId must be a non-empty string', 400)
  }
  if (typeof input.description !== 'string') {
    throw new CronUpdateError('Description must be a string', 400)
  }
  if (typeof input.message !== 'string') {
    throw new CronUpdateError('Message must be a string', 400)
  }
  if (!Number.isInteger(input.timeoutSeconds) || Number(input.timeoutSeconds) <= 0) {
    throw new CronUpdateError('Timeout must be a positive integer', 400)
  }

  return {
    jobId,
    description: input.description,
    message: input.message,
    timeoutSeconds: Number(input.timeoutSeconds),
  }
}

function resolveOpenClawBin(): string {
  return process.env.OPENCLAW_BIN || detectOpenClawBin() || 'openclaw'
}

export async function PUT(req: Request) {
  try {
    const body = validateCronUpdateBody(await req.json())
    const currentCrons = await getCrons()
    const currentJob = currentCrons.find((cron) => cron.id === body.jobId)

    if (!currentJob) {
      return NextResponse.json({ error: `Cron job not found: ${body.jobId}` }, { status: 404 })
    }

    const args = ['cron', 'edit', body.jobId]

    if (body.description !== (currentJob.description ?? '')) {
      args.push('--description', body.description)
    }
    if (body.message !== (currentJob.payload?.message ?? '')) {
      args.push('--message', body.message)
    }
    if (body.timeoutSeconds !== (currentJob.payload?.timeoutSeconds ?? null)) {
      args.push('--timeout-seconds', String(body.timeoutSeconds))
    }

    if (args.length > 3) {
      try {
        execFileSync(resolveOpenClawBin(), args, {
          encoding: 'utf-8',
          timeout: 15000,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      } catch (err) {
        const mapped = mapCronUpdateError(err)
        return NextResponse.json({ error: mapped.message }, { status: mapped.status })
      }
    }

    clearCronsCache()
    const updatedCrons = await getCrons()
    const updatedJob = updatedCrons.find((cron) => cron.id === body.jobId)

    if (!updatedJob) {
      return NextResponse.json(
        { error: `Cron job updated but failed to reload refreshed data for ${body.jobId}` },
        { status: 502 },
      )
    }

    return NextResponse.json({ ok: true, job: updatedJob })
  } catch (err) {
    if (err instanceof CronUpdateError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return apiErrorResponse(err, 'Failed to update cron job')
  }
}
