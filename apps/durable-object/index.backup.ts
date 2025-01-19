import { CloudflareDurableObjectSqliteSaver } from "./cf-sqlite";
import { workflow } from "./langgraph";
import { Server, getServerByName } from "partyserver";

interface Env {
  Agent: DurableObjectNamespace<Agent>;
}

export class Agent extends Server<Env> {
  static options = {
    // Hibernate the DO when it's not in use
    hibernate: true,
  };

  checkpointer = new CloudflareDurableObjectSqliteSaver(this.ctx.storage.sql);

  app = workflow.compile({
    checkpointer: this.checkpointer,
  });

  async runGraph(): Promise<string> {
    const messages = [
      {
        role: "user" as const,
        content: "Hello, how can I help you today?",
      },
      {
        role: "user" as const,
        content: "heyyyy",
      },
    ];
    try {
      console.log("running graph");
      console.log(this.app);
      const finalState = await this.app.invoke(
        { messages },
        { configurable: { thread_id: "42" } }
      );
      console.log(finalState);
      return finalState.messages[finalState.messages.length - 1].content;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  async getMessages() {
    const messages = await this.checkpointer?.get({
      configurable: {
        thread_id: "42",
      },
    });
    console.log(messages);
    return messages;
  }
}

const ROOM_NAME = "some-room";

// TODO: add hono router here.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/graph") {
      const stub = await getServerByName(env.Agent, ROOM_NAME);
      const rpcResponse = await stub.runGraph();

      return new Response(rpcResponse);
    }

    if (pathname === "/messages") {
      const stub = await getServerByName(env.Agent, ROOM_NAME);
      const rpcResponse = await stub.getMessages();

      return Response.json(rpcResponse);
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
