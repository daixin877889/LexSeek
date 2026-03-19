import { createDeepAgent, CompositeBackend, StateBackend, StoreBackend } from "deepagents";
import { ChatAnthropic } from "@langchain/anthropic";
import { getCheckpointer } from "../workflow/checkpointer";


export const mainAgent = async (sessionId: string, prompt: string) => {

    const checkpointer = await getCheckpointer();

    const model = new ChatAnthropic({
        model: "deepseek-reasoner",
        apiKey: "sk-62418816f329463b8608cab7851fe4da",
        anthropicApiUrl: "https://api.deepseek.com/anthropic",
        thinking: { type: "enabled" },
    } as any);


    const agent: any = createDeepAgent({
        model,
        systemPrompt: "你是一个专业的律师，请根据用户的问题，给出专业的回答。",
        checkpointer,
    });

    const streamConfig: any = {
        configurable: {
            thread_id: sessionId
        },
        streamMode: ["values", "messages", "custom"],
        version: 'v2',
        subgraphs: true
    };

    const result = await agent.streamEvents(
        {
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
        },
        streamConfig
    );


    // const result = await agent.stream(
    //     {
    //         messages: [
    //             {
    //                 role: "user",
    //                 content: prompt,
    //             },
    //         ],
    //     },
    //     streamConfig
    // );

    return result;
}
