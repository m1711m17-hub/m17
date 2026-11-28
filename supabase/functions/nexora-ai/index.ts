import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SYSTEM_PROMPT = `أنت NEXORA AI، المساعد الذكي داخل تطبيق NEXORA للتواصل الاجتماعي.
أجب باللغة التي يستخدمها الشخص، وفضّل العربية الواضحة عند استخدام العربية.
ساعد في الأسئلة العامة، وصياغة المنشورات والرسائل، والترجمة، واقتراح الردود، وتلخيص النصوص.
كن ودوداً ومختصراً ودقيقاً. لا تدّعِ أنك نفذت إجراءً داخل التطبيق أو أنك ترى بيانات المستخدم الخاصة.
إذا لم تعرف الإجابة فقل ذلك بوضوح. لا تطلب كلمات المرور أو رموز التحقق أو مفاتيح API.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const model = Deno.env.get("OPENAI_MODEL") || "gpt-6.2-sol";
  if (!supabaseUrl || !supabaseAnonKey || !openaiKey) {
    return json({ error: "إعداد خدمة الذكاء الاصطناعي غير مكتمل على الخادم" }, 503);
  }

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "يجب تسجيل الدخول لاستخدام NEXORA AI" }, 401);

  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseAnonKey, Authorization: auth },
    });
    if (!userRes.ok) return json({ error: "انتهت الجلسة، سجّل الدخول من جديد" }, 401);

    const raw = await req.json();
    const incoming = Array.isArray(raw?.messages) ? raw.messages : [];
    if (!incoming.length || incoming.length > 12) return json({ error: "عدد الرسائل غير صالح" }, 400);

    const messages = incoming.map((m: any) => ({
      role: m?.role === "assistant" ? "assistant" : "user",
      content: typeof m?.content === "string" ? m.content.trim().slice(0, 4000) : "",
    })).filter((m: any) => m.content);
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return json({ error: "اكتب رسالة قبل الإرسال" }, 400);
    }

    const aiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        instructions: SYSTEM_PROMPT,
        input: messages,
        max_output_tokens: 900,
        store: false,
      }),
    });
    const result = await aiRes.json().catch(() => ({}));
    if (!aiRes.ok) {
      console.error("OpenAI API error", aiRes.status, result?.error?.code || result?.error?.type || "unknown");
      return json({ error: aiRes.status === 429 ? "تم تجاوز حد الاستخدام مؤقتاً، حاول لاحقاً" : "تعذر الحصول على رد من الذكاء الاصطناعي" }, 502);
    }

    const reply = typeof result.output_text === "string" ? result.output_text :
      (result.output || []).flatMap((item: any) => item.content || [])
        .filter((part: any) => part.type === "output_text").map((part: any) => part.text || "").join("\n");
    if (!reply.trim()) return json({ error: "لم يصل رد نصي من المساعد" }, 502);
    return json({ reply: reply.trim() });
  } catch (error) {
    console.error("NEXORA AI function error", error?.message || error);
    return json({ error: "حدث خطأ غير متوقع. حاول مرة أخرى." }, 500);
  }
});
