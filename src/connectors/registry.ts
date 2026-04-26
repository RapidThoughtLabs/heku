import type { ConnectorType } from "../types.js";
import type { IConnector } from "./base.js";

class ConnectorRegistry {
  private connectors = new Map<ConnectorType, IConnector>();

  register(connector: IConnector): void {
    this.connectors.set(connector.type, connector);
  }

  get(type: ConnectorType): IConnector {
    const c = this.connectors.get(type);
    if (!c) throw new Error(`No connector registered for type: "${type}"`);
    return c;
  }

  async initAll(): Promise<void> {
    for (const c of this.connectors.values()) {
      if (c.init) await c.init();
    }
  }

  async teardownAll(): Promise<void> {
    for (const c of this.connectors.values()) {
      if (c.teardown) await c.teardown();
    }
  }
}

export const connectorRegistry = new ConnectorRegistry();
