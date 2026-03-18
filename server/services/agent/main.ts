import { createDeepAgent, CompositeBackend, StateBackend, StoreBackend } from "deepagents";
import { MemorySaver } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatDeepSeek } from "@langchain/deepseek";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { getCheckpointer } from "../workflow/checkpointer";




export const mainAgent = async (sessionId: string, prompt: string) => {

    const checkpointer = await getCheckpointer();



    const model = new ChatDeepSeek({
        model: "deepseek-reasoner",
        apiKey: "sk-62418816f329463b8608cab7851fe4da",
        anthropicApiUrl: "https://api.deepseek.com/anthropic",

    } as any);

    const agent = createDeepAgent({
        model,
        systemPrompt: "你是一个专业的律师，请根据用户的问题，给出专业的回答。",
        checkpointer,
        // backend: (config) => new CompositeBackend(
        //     new StateBackend(config),
        //     { "/memories/": new StoreBackend(config) }
        // ),
    });

    const result = await agent.stream(
        {
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
        },
        {

            configurable: {
                thread_id: sessionId,
            },
            streamMode: ["updates", "messages", "custom"], subgraphs: true
        }
    );

    return result;
}
