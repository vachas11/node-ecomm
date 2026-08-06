import http from 'http';
import https from 'https';
import logger from '../../../../shared/logger';

interface PoolStats {
  created: number;
  requests: number;
  protocol: string;
}

class ConnectionPool {
  private agents: Map<string, http.Agent | https.Agent> = new Map();
  private stats: Map<string, PoolStats> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  getAgent(serviceName: string, serviceUrl: string): http.Agent | https.Agent {
    const key = `${serviceName}:${serviceUrl}`;

    if (!this.agents.has(key)) {
      const isHttps = serviceUrl.startsWith('https://');
      const Agent = isHttps ? https.Agent : http.Agent;

      const agent = new Agent({
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 100,
        maxFreeSockets: 10,
        timeout: 60000,
        scheduling: 'lifo'
      });

      this.agents.set(key, agent);
      this.stats.set(key, {
        created: Date.now(),
        requests: 0,
        protocol: isHttps ? 'https' : 'http'
      });

      logger.debug(`Created connection pool for ${serviceName}`, {
        service: serviceName,
        url: serviceUrl,
        protocol: isHttps ? 'https' : 'http'
      });
    }

    const stats = this.stats.get(key)!;
    stats.requests++;

    return this.agents.get(key)!;
  }

  getStats(serviceName?: string): PoolStats[] | Record<string, PoolStats & { age: number }> {
    if (serviceName) {
      const stats: (PoolStats & { key: string; age: number })[] = [];
      for (const [key, stat] of this.stats.entries()) {
        if (key.startsWith(`${serviceName}:`)) {
          stats.push({ key, ...stat, age: Date.now() - stat.created });
        }
      }
      return stats;
    }

    const allStats: Record<string, PoolStats & { age: number }> = {};
    for (const [key, stat] of this.stats.entries()) {
      allStats[key] = { ...stat, age: Date.now() - stat.created };
    }
    return allStats;
  }

  getHealth(): Record<string, { activeSockets: number; freeSockets: number; requests: number }> {
    const health: Record<string, { activeSockets: number; freeSockets: number; requests: number }> = {};

    for (const [key, agent] of this.agents.entries()) {
      const sockets = (agent as any).sockets || {};
      const freeSockets = (agent as any).freeSockets || {};

      const totalSockets = Object.values(sockets).reduce((sum: number, arr: any) => sum + arr.length, 0);
      const totalFree = Object.values(freeSockets).reduce((sum: number, arr: any) => sum + arr.length, 0);

      health[key] = {
        activeSockets: totalSockets,
        freeSockets: totalFree,
        requests: this.stats.get(key)?.requests || 0
      };
    }

    return health;
  }

  destroyAgent(serviceName: string): void {
    for (const [key, agent] of this.agents.entries()) {
      if (key.startsWith(`${serviceName}:`)) {
        agent.destroy();
        this.agents.delete(key);
        this.stats.delete(key);
        logger.info(`Destroyed connection pool for ${serviceName}`);
      }
    }
  }

  destroyAll(): void {
    for (const agent of this.agents.values()) {
      agent.destroy();
    }
    this.agents.clear();
    this.stats.clear();
    logger.info('Destroyed all connection pools');
  }

  startCleanup(intervalMs = 60000): void {
    this.cleanupInterval = setInterval(() => {
      logger.debug('Running connection pool cleanup');
      for (const [key, agent] of this.agents.entries()) {
        const freeSockets = (agent as any).freeSockets || {};
        const totalFree = Object.values(freeSockets).reduce((sum: number, arr: any) => sum + arr.length, 0);
        if (totalFree > 0) {
          logger.debug('Connection pool cleanup', { key, freeSockets: totalFree });
        }
      }
    }, intervalMs);
  }

  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

const connectionPool = new ConnectionPool();
export default connectionPool;
