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
  // 尝试匹配 { ... } 格式
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0].trim();
  }
  // 如果没有代码块，直接返回原文本
  return text.trim();
}

// 清理终端控制序列
function cleanTerminalOutput(text: string): string {
  return text
    // 移除 ANSI 转义序列
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    // 移除其他控制字符
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    // 移除 spinner 字符
    .replace(/[✻✽✶✳✢·⠂⠐]/g, '')
    // 压缩多余空白
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function generateSummary(outputBuffer: string[]): Promise<SummaryResult> {
  const rawOutput = outputBuffer.slice(-100).join('\n');
  const recentOutput = cleanTerminalOutput(rawOutput);

  // 如果清理后内容太少，返回默认值
  if (recentOutput.length < 20) {
    return { title: '新会话', summary: '会话内容较少，无法生成概括' };
  }

  // 截断过长的内容，避免 token 超限
  const truncatedOutput = recentOutput.length > 4000
    ? recentOutput.slice(-4000)
    : recentOutput;

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
${truncatedOutput}

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
  } catch (error: unknown) {
    // 详细的错误处理
    const err = error as { status?: number; message?: string };
    if (err.status === 429) {
      console.error('Summary generation rate limited');
      return { title: '新会话', summary: 'API 限流，请稍后重试' };
    } else if (err.status === 401) {
      console.error('Summary generation auth error');
      return { title: '新会话', summary: 'API Key 无效' };
    } else if (err.message?.includes('JSON')) {
      console.error('Summary JSON parse error:', err.message);
      return { title: '新会话', summary: '响应解析失败' };
    } else {
      console.error('Summary generation error:', error);
      return { title: '新会话', summary: '概括生成失败' };
    }
  }
}
