import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export interface SummaryResult {
  summary: string;
  title: string;
}

// 从可能包含 markdown 代码块的文本中提取 JSON
function extractJson(text: string): string {
  // 尝试匹配 ```json ... ``` 或 ``` ... ```
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  // 如果没有代码块，直接返回原文本
  return text.trim();
}

export async function generateSummary(outputBuffer: string[]): Promise<SummaryResult> {
  const recentOutput = outputBuffer.slice(-100).join('\n');

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `请用中文分析以下 Claude Code 会话内容，输出 JSON 格式：
{
  "title": "10字以内的简短标题",
  "summary": "50字以内的内容概括"
}

会话内容：
${recentOutput}

只输出 JSON，不要其他说明。`
      }]
    });

    const content = response.content[0];
    if (content.type === 'text') {
      const jsonStr = extractJson(content.text);
      const result = JSON.parse(jsonStr);
      return {
        title: result.title || '新会话',
        summary: result.summary || '无法生成概括'
      };
    }
    return { title: '新会话', summary: '无法生成概括' };
  } catch (error) {
    console.error('Summary generation error:', error);
    return { title: '新会话', summary: '概括生成失败' };
  }
}
