/**
 * Endpoint Analysis Script
 *
 * Queries Prometheus to find:
 * 1. Most used endpoints (highest traffic)
 * 2. Slowest endpoints (highest latency)
 * 3. Highest load endpoints (traffic × latency)
 *
 * Usage:
 *   node scripts/analyze-endpoints.js
 *   node scripts/analyze-endpoints.js --service=user-service
 *   node scripts/analyze-endpoints.js --top=20
 */

const axios = require('axios');

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://localhost:9090';
const SERVICE = process.argv.find(arg => arg.startsWith('--service='))?.split('=')[1] || '';
const TOP_N = parseInt(process.argv.find(arg => arg.startsWith('--top='))?.split('=')[1] || '10');

/**
 * Query Prometheus and return results
 */
async function queryPrometheus(query) {
  try {
    const response = await axios.get(`${PROMETHEUS_URL}/api/v1/query`, {
      params: { query }
    });

    if (response.data.status !== 'success') {
      throw new Error(`Prometheus query failed: ${response.data.error}`);
    }

    return response.data.data.result;
  } catch (error) {
    console.error('❌ Prometheus query error:', error.message);
    return [];
  }
}

/**
 * Get most used endpoints (highest traffic)
 */
async function getMostUsedEndpoints() {
  console.log('\n📊 TOP ENDPOINTS BY TRAFFIC (Requests/sec)\n');
  console.log('═'.repeat(80));

  const serviceFilter = SERVICE ? `{service="${SERVICE}"}` : '';
  const query = `
    topk(${TOP_N},
      sum(rate(http_requests_total${serviceFilter}[5m])) by (service, method, path)
    )
  `;

  const results = await queryPrometheus(query);

  if (results.length === 0) {
    console.log('No data found. Make sure services are running and generating traffic.\n');
    return;
  }

  results.forEach((result, index) => {
    const { service, method, path } = result.metric;
    const requestsPerSec = parseFloat(result.value[1]).toFixed(2);

    console.log(`${index + 1}. ${requestsPerSec.padStart(8)} req/s | ${service.padEnd(15)} | ${method.padEnd(6)} ${path}`);
  });

  console.log('═'.repeat(80));
}

/**
 * Get slowest endpoints (highest P95 latency)
 */
async function getSlowestEndpoints() {
  console.log('\n🐌 SLOWEST ENDPOINTS (P95 Latency)\n');
  console.log('═'.repeat(80));

  const serviceFilter = SERVICE ? `{service="${SERVICE}"}` : '';
  const query = `
    topk(${TOP_N},
      histogram_quantile(0.95,
        sum(rate(http_request_duration_seconds_bucket${serviceFilter}[5m])) by (service, method, path, le)
      )
    )
  `;

  const results = await queryPrometheus(query);

  if (results.length === 0) {
    console.log('No latency data found. Check if histogram metrics are being recorded.\n');
    return;
  }

  results.forEach((result, index) => {
    const { service, method, path } = result.metric;
    const latency = parseFloat(result.value[1]).toFixed(3);
    const latencyMs = (latency * 1000).toFixed(0);

    console.log(`${index + 1}. ${latency.padStart(7)}s (${latencyMs.padStart(5)}ms) | ${service.padEnd(15)} | ${method.padEnd(6)} ${path}`);
  });

  console.log('═'.repeat(80));
}

/**
 * Get endpoints with highest load (traffic × latency)
 */
async function getHighestLoadEndpoints() {
  console.log('\n⚡ HIGHEST LOAD ENDPOINTS (Traffic × Latency = Server Capacity)\n');
  console.log('═'.repeat(80));

  const serviceFilter = SERVICE ? `{service="${SERVICE}"}` : '';
  const query = `
    topk(${TOP_N},
      sum(rate(http_requests_total${serviceFilter}[5m])) by (service, method, path)
      *
      histogram_quantile(0.95,
        sum(rate(http_request_duration_seconds_bucket${serviceFilter}[5m])) by (service, method, path, le)
      )
    )
  `;

  const results = await queryPrometheus(query);

  if (results.length === 0) {
    console.log('No load data found.\n');
    return;
  }

  results.forEach((result, index) => {
    const { service, method, path } = result.metric;
    const loadScore = parseFloat(result.value[1]).toFixed(2);

    // Visual bar chart
    const barLength = Math.min(Math.floor(loadScore / 2), 40);
    const bar = '█'.repeat(barLength);

    console.log(`${index + 1}. ${loadScore.padStart(8)} | ${bar.padEnd(40)} | ${service.padEnd(15)} | ${method.padEnd(6)} ${path}`);
  });

  console.log('═'.repeat(80));
  console.log('\n💡 Load Score = Requests/sec × P95 Latency');
  console.log('   Higher score = More server capacity consumed');
  console.log('   Optimize these endpoints first for maximum impact\n');
}

/**
 * Get error rates by endpoint
 */
async function getEndpointErrorRates() {
  console.log('\n❌ ERROR RATES BY ENDPOINT\n');
  console.log('═'.repeat(80));

  const serviceFilter = SERVICE ? `{service="${SERVICE}"}` : '';
  const query = `
    topk(${TOP_N},
      (
        sum(rate(http_requests_total${serviceFilter}{status_code=~"5.."}[5m])) by (service, method, path)
        /
        sum(rate(http_requests_total${serviceFilter}[5m])) by (service, method, path)
      ) * 100
    )
  `;

  const results = await queryPrometheus(query);

  if (results.length === 0) {
    console.log('✅ No endpoints with errors found!\n');
    return;
  }

  results.forEach((result, index) => {
    const { service, method, path } = result.metric;
    const errorRate = parseFloat(result.value[1]).toFixed(2);

    const status = errorRate > 5 ? '🔴' : errorRate > 1 ? '🟡' : '🟢';

    console.log(`${index + 1}. ${status} ${errorRate.padStart(6)}% | ${service.padEnd(15)} | ${method.padEnd(6)} ${path}`);
  });

  console.log('═'.repeat(80));
}

/**
 * Get detailed breakdown for a specific endpoint
 */
async function getEndpointDetails(path) {
  console.log(`\n📋 DETAILED ANALYSIS: ${path}\n`);
  console.log('═'.repeat(80));

  const serviceFilter = SERVICE ? `service="${SERVICE}",` : '';

  // Traffic
  const trafficQuery = `sum(rate(http_requests_total{${serviceFilter}path="${path}"}[5m]))`;
  const trafficResults = await queryPrometheus(trafficQuery);
  const traffic = trafficResults[0] ? parseFloat(trafficResults[0].value[1]).toFixed(2) : '0';

  // P50, P95, P99 latencies
  const p50Query = `histogram_quantile(0.50, sum(rate(http_request_duration_seconds_bucket{${serviceFilter}path="${path}"}[5m])) by (le))`;
  const p95Query = `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{${serviceFilter}path="${path}"}[5m])) by (le))`;
  const p99Query = `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{${serviceFilter}path="${path}"}[5m])) by (le))`;

  const p50Results = await queryPrometheus(p50Query);
  const p95Results = await queryPrometheus(p95Query);
  const p99Results = await queryPrometheus(p99Query);

  const p50 = p50Results[0] ? (parseFloat(p50Results[0].value[1]) * 1000).toFixed(0) : '0';
  const p95 = p95Results[0] ? (parseFloat(p95Results[0].value[1]) * 1000).toFixed(0) : '0';
  const p99 = p99Results[0] ? (parseFloat(p99Results[0].value[1]) * 1000).toFixed(0) : '0';

  // Error rate
  const errorQuery = `(sum(rate(http_requests_total{${serviceFilter}path="${path}",status_code=~"5.."}[5m])) / sum(rate(http_requests_total{${serviceFilter}path="${path}"}[5m]))) * 100`;
  const errorResults = await queryPrometheus(errorQuery);
  const errorRate = errorResults[0] ? parseFloat(errorResults[0].value[1]).toFixed(2) : '0';

  console.log(`Traffic:       ${traffic} requests/sec`);
  console.log(`Latency P50:   ${p50}ms`);
  console.log(`Latency P95:   ${p95}ms`);
  console.log(`Latency P99:   ${p99}ms`);
  console.log(`Error Rate:    ${errorRate}%`);
  console.log('═'.repeat(80));
}

/**
 * Main function
 */
async function main() {
  console.log('\n🔍 ENDPOINT ANALYSIS REPORT');
  console.log(`📅 Time: ${new Date().toLocaleString()}`);
  console.log(`🌐 Prometheus: ${PROMETHEUS_URL}`);
  if (SERVICE) {
    console.log(`🎯 Service Filter: ${SERVICE}`);
  }
  console.log(`📊 Top N: ${TOP_N}`);

  await getMostUsedEndpoints();
  await getSlowestEndpoints();
  await getHighestLoadEndpoints();
  await getEndpointErrorRates();

  // Example: Get details for specific endpoint
  // await getEndpointDetails('/api/auth/login');
}

// Run
main().catch(console.error);
