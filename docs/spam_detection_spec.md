# Spam Detection Spec

This specification focuses on leveraging GPT-based analysis **as the core method** for proactively identifying suspicious or scam accounts before they harass or spam legitimate users. Heuristics still play a supporting role, but the primary emphasis is on robust LLM-driven detection. Additionally, we provide details on prompt strategies, few-shot examples, and potential fine-tuning to maximize accuracy.

---

## 1. Overview

Our bot aims to **proactively** detect and classify suspicious users who might engage in scams, phishing, or spam-like activity—even if they haven’t obviously broken rules yet. While basic heuristics (flood detection, keyword checks) remain useful, **GPT-based detection** lies at the heart of this system, allowing us to:

1. Analyze subtle patterns or suspicious profiles.
2. Make informed decisions on user authenticity.
3. Intervene **before** harm occurs.

---

## 2. GPT-Enhanced First Pass Detection

### 2.1 Core GPT Detection Workflow

1. **User Context Gathering** – Before taking any major action, the bot compiles relevant data:
   - Discord handle, nickname (check for unusual characters, pronounceability)
   - Profile metadata (bio, creation date, connected accounts)
   - Server join date (recent joins are more suspect)
   - Any known or rumored malicious behavior
2. **Prompt Construction** – The bot assembles a structured prompt:

   ```yaml
   System Prompt:
   "You are a Discord moderation assistant. Based on the user’s profile, connected accounts, and creation date, classify whether the user is suspicious. If suspicious, respond 'SUSPICIOUS'; if normal, respond 'OK'."

   User Message:
   "Profile info: {username}, created {creation_date}, joined server on {join_date}, connected accounts: {accounts}...\nBio: {bio}\nAdditional notes: {any relevant server heuristics}"
   ```

3. **LLM Request** – The bot queries GPT (e.g., GPT-3.5-turbo) with the structured prompt.
4. **Classification & Confidence** – GPT responds with a classification (e.g., `SUSPICIOUS` or `OK`) and an accompanying confidence/explanation if requested.
5. **Flag/Not Flag** – If `SUSPICIOUS`, the bot flags the user, triggers verification or restricted role assignment.

### 2.2 Prompt Tuning & Few-Shot Examples

- **Few-Shot Approach** – Provide short examples of real or synthetic profiles to guide GPT’s reasoning:

  ```yaml
  System Prompt:
  "You are a Discord moderation assistant..."

  # Example 1
  "Profile info: Username=catfisher123, created 2 days ago, no mutual servers, suspicious bio\nBio: 'Looking for new friends'\nLLM classification: SUSPICIOUS"

  # Example 2
  "Profile info: Username=longtermMember, created 3 years ago, well-known in 3 mutual servers, normal bio\nBio: 'I love gaming and photography'\nLLM classification: OK"

  # New user to classify...
  "Profile info: {actual user data here}"
  ```

- **Refining the Prompt** – We iterate on these examples over time, capturing borderline cases and clarifying what constitutes suspicious behavior (fake profile pics, brand-new accounts with minimal info, suspicious external accounts, etc.).

### 2.3 Heuristic Support

Though GPT analysis is primary, we still incorporate:

- **Excessive Link/Keyword Checks** – The user has suspicious or known scam links in bio.
- **Rate Limit Surpassing** – The user posts repeated or high-volume messages.
- **Immediate Join + Mass DMs** – A known spam pattern.

These heuristics can:

1. Increase the user’s suspicion score prior to GPT.
2. Potentially skip GPT if clearly spam.

### 2.4 Example Flow

1. **User Joins** – The bot collects user’s creation date, bio, external connections.
2. **Bot Calls GPT** with the compiled data, plus a few-shot prompt.
3. **GPT Responds** – e.g., `"SUSPICIOUS"`, citing new account with generic bio.
4. **Bot Flags User** – Restricts role, opens verification ticket, or notifies admins.
5. **Verification** – Admin can override or confirm suspicion.

---

## 3. Future/Second Pass: Fine-Tuning and Enhanced Intelligence

### 3.1 Fine-Tuned GPT Model

- **Scenario**: We gather large volumes of confirmed spam and scam profiles from multiple servers.
- **Approach**: Fine-tune a GPT model (or use open-source LLM) specifically on these examples.
- **Benefit**: More accurate detection of subtle scam behavior, fewer false positives.

### 3.2 Cross-Server User Reputation

- **Trusted Networks**: If user is flagged as suspicious in many servers, raise suspicion globally.
- **Verification Records**: If a user was previously verified in a reputable server, lower suspicion.

### 3.3 Additional Data Points

- **Image Analysis**: Evaluate profile pictures or banner images.
- **Behavioral Logs**: Track how quickly a user starts messaging, DM patterns, or friend requests.

---

## 4. Prompt Strategy & Best Practices

1. **Concise, Clear Instructions** – GPT performs better when it knows exactly what format and response you need.
2. **Few-Shot Examples** – Provide short but relevant user profiles labeled as `SUSPICIOUS` or `OK`.
3. **Contextual Metadata** – Summaries of the user’s behavior or known links to suspicious activity.
4. **Avoid Overloading** – Too much data can confuse the model; keep it succinct.
5. **Iterative Improvement** – Refine and rotate examples if you observe consistent misclassifications.

---

## 5. Technical Implementation Details

- **Real-Time GPT Calls** – Each new or existing user is analyzed once upon significant events (join, suspicious action). Rate-limit calls.
- **Confidence Threshold** – If the LLM output is borderline, we can do a second call or add a short delay for re-check.
- **Logging** – Keep track of raw GPT responses for debugging and building fine-tuning datasets.
- **Heuristics** – Weighted scoring system that bumps suspicion score if known spam patterns appear. If final score > threshold, we rely on GPT’s classification.

---

## 6. Example Prompt Snippet

```yaml
System Prompt:
"You are a moderation assistant for a Discord server that aims to proactively detect suspicious or scam users.\n\nRules:\n- If you find strong indicators of scam/spam, respond SUSPICIOUS.\n- If user looks normal, respond OK.\n- Provide a short explanation if requested."

User Prompt:
"Profile info:\n- Discord Name: {username}\n- Account Age: {account_age} days\n- Bio: '{bio}'\n- Connected Accounts: {connections}\n- Known Behavior: {heuristic_flags}\n\nExamples:\n1) Username=botlikeUser, created 2 days ago, Bio='Hi I just want to be your friend', SUSPICIOUS\n2) Username=legitGamer, created 500 days ago, Bio='I love this server', OK\n\nAnswer strictly with either 'SUSPICIOUS' or 'OK'"
```

---

## 7. Conclusion

**Core Goal**: Use GPT as the driving force of proactive scam/spam detection, supplemented by heuristics to identify blatant red flags and feed relevant data into GPT. Over time, we refine prompts, add few-shot examples, and consider fine-tuning for higher accuracy.

This refined approach:

1. **Targets subtle scam accounts** that are not obviously spamming.
2. **Proactively intervenes** before they harm server members.
3. **Continuously evolves** through iterative prompt improvements, new heuristics, and potential fine-tuning.
