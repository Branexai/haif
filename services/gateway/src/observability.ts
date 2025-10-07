import type { FastifyInstance, FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { Resource } from '@opentelemetry/resources'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { metrics, context, trace } from '@opentelemetry/api'

const serviceName = process.env.SERVICE_NAME || 'gateway'

const prometheusPort = Number(process.env.OTEL_PROMETHEUS_PORT || 9464)
const prometheusEndpoint = process.env.OTEL_PROMETHEUS_ENDPOINT || '/metrics'
const prometheusExporter = new PrometheusExporter({ port: prometheusPort, endpoint: prometheusEndpoint })

const otlpTracesUrl = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || 'http://jaeger:4318/v1/traces'

const sdk = new (NodeSDK as any)({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '0.1.0'
  }),
  traceExporter: new OTLPTraceExporter({ url: otlpTracesUrl }),
  metricReader: prometheusExporter,
  instrumentations: [getNodeAutoInstrumentations()]
});

(async () => {
  try {
    await sdk.start()
  } catch (err: unknown) {
    // eslint-disable-next-line no-console
    console.error('OpenTelemetry init failed', err)
  }
})()

export function setupHttpMetrics(app: FastifyInstance) {
  const meter = metrics.getMeter(serviceName)
  const requestsTotal = meter.createCounter('http_requests_total', { description: 'Total HTTP requests' })
  const requestErrorsTotal = meter.createCounter('http_request_errors_total', { description: 'Total HTTP request errors' })
  const requestDuration = meter.createHistogram('http_request_duration_seconds', { description: 'Duration of HTTP requests', unit: 's' })

  app.addHook('onRequest', (req: FastifyRequest, _reply: FastifyReply, done: HookHandlerDoneFunction) => {
    ;(req as any).__start = process.hrtime.bigint()
    requestsTotal.add(1, { method: req.method, route: (req as any).routerPath ?? req.url, service: serviceName })
    const span = trace.getSpan(context.active())
    const traceId = span?.spanContext().traceId
    if (traceId) {
      req.log = req.log.child({ trace_id: traceId, service: serviceName })
    }
    done()
  })

  app.addHook('onResponse', (req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
    const start = (req as any).__start as bigint | undefined
    if (start) {
      const durationNs = Number(process.hrtime.bigint() - start)
      const durationSec = durationNs / 1e9
      requestDuration.record(durationSec, { method: req.method, route: (req as any).routerPath ?? req.url, status_code: String(reply.statusCode), service: serviceName })
    }
    if (reply.statusCode >= 500) {
      requestErrorsTotal.add(1, { method: req.method, route: (req as any).routerPath ?? req.url, status_code: String(reply.statusCode), service: serviceName })
    }
    done()
  })
}