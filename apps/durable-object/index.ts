import { CloudflareDurableObjectSqliteSaver } from "./cf-sqlite";
import { workflow } from "./multi-agent";
import { Server, routePartykitRequest, Connection } from "partyserver";
import { HumanMessage } from "@langchain/core/messages";
type Env = {
  Agent: DurableObjectNamespace<Agent>;
};

import { context } from "./context";

const prettifyOutput = (output: Record<string, any>) => {
  const keys = Object.keys(output);
  const firstItem = output[keys[0]];

  if ("messages" in firstItem && Array.isArray(firstItem.messages)) {
    const lastMessage = firstItem.messages[firstItem.messages.length - 1];
    console.dir(
      {
        type: lastMessage._getType(),
        content: lastMessage.content,
        tool_calls: lastMessage.tool_calls,
      },
      { depth: null }
    );
  }

  if ("sender" in firstItem) {
    console.log({
      sender: firstItem.sender,
    });
  }
};

export class Agent extends Server<Env> {
  static options = {
    // Hibernate the DO when it's not in use
    hibernate: true,
  };

  started = false;

  checkpointer = new CloudflareDurableObjectSqliteSaver(this.ctx.storage.sql);

  app = workflow.compile({
    checkpointer: this.checkpointer,
  });

  outputs: any[] = [];

  onConnect(connection: Connection) {
    connection.send(
      JSON.stringify({
        type: "initial",
        outputs: this.outputs,
      })
    );
    this.start();
  }

  async start() {
    if (this.started) {
      return;
    }

    this.started = true;
    // const ctx = context.getStore();
    context.run({ do: this }, async () => {
      const streamResults = await this.app.stream(
        {
          messages: [
            new HumanMessage({
              content:
                "Generate a bar chart of the US gdp over the past 3 years.",
            }),
          ],
        },
        { recursionLimit: 150 }
      );

      for await (const output of streamResults) {
        this.outputs.push(output);
        if (!output?.__end__) {
          prettifyOutput(output);
          console.log("----");
        }
        this.broadcast(
          JSON.stringify({
            type: "update",
            output,
          })
        );
      }
    });
  }
}

// TODO: add hono router here.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ||
      new Response("Not Found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
