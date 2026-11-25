---
title: 'Introducing jargo: real-time voice agents in Go'
description: 'jargo is a Go framework for voice agents: WebRTC or phone audio in, a streaming STT, LLM and TTS pipeline with turn-taking and barge-in, and audio back out, from one static binary.'
date: 2026-11-25
authors: fallais
tags:
  - announcement
  - go
  - voice agents
excerpt: 'jargo is a Go framework for real-time voice agents. It ports the design of Pipecat, the Python framework, to Go, and serves 1,000 concurrent sessions in 124 MiB.'
---

A voice agent looks like an AI problem, but most of the server is plumbing.
Audio arrives over WebRTC or a phone line in 20 ms packets. It has to be decoded,
resampled, run through voice activity detection, streamed to a speech-to-text
service, handed to an LLM once the user has finished their turn, and the reply
streamed through text-to-speech and back out, all while listening for the
moment the user interrupts, so the bot can stop talking mid-word.

**jargo** is a framework for that plumbing, in Go. It is open source under the
BSD 2-Clause license, and its source is at
[github.com/gojargo/jargo](https://github.com/gojargo/jargo).

## A port, not a reinvention

[Pipecat](https://github.com/pipecat-ai/pipecat) is the reference open-source
framework for voice agents, and jargo is a port of it. The architecture is
Pipecat's: frames flowing through a pipeline of processors, service bases that
turn any provider into a processor, context aggregators, RTVI for the client.
So are many of the design decisions, which have been tested in production by a
lot of people. Porting them, rather than inventing a new design, is a
deliberate choice: a voice pipeline has many subtle edge cases (an interruption
that lands while a tool call is in flight, a transcript that arrives after the
turn has ended) and Pipecat has already found most of them.

If you know Pipecat, you know jargo. A `PipelineTask` is a `pipeline.Worker`, a
`PipelineRunner` is a `workers.Runner`, and the rest mostly keeps its name.

## Why Go

Python is the right language when you need the AI and data-science ecosystem.
A real-time voice server mostly does not: the models run behind APIs or as ONNX,
and what remains is audio framing, networking and concurrency. For that, Go has
a few concrete advantages:

- **One static binary.** The default build is cgo-free: `CGO_ENABLED=0 go build`
  works with no C toolchain. Opus and resampling are pure Go, and the Silero VAD
  and Smart Turn models are embedded in the binary. The ONNX Runtime they run on
  is loaded at run time, so it is never needed to build.
- **Real concurrency.** Every processor runs independently, and one process uses
  every CPU it is given. There is no global interpreter lock, so there is no
  need for one process per core.
- **Low, predictable memory**, and fast startup per session.

## The numbers

The repository has a benchmark suite that runs the same scenarios against jargo
and Pipecat, each in its own container pinned to the same CPUs and memory. This
is one run of the deployment benchmark: 1,000 concurrent sessions on 3 CPUs, one
jargo process against one Pipecat 1.15 process per CPU.

| | jargo | Pipecat |
|---|---|---|
| Memory, idle | 8.6 MiB | 162 MiB |
| Memory, 1,000 sessions | 124 MiB | 357 MiB |
| Throughput | 96k frames/s | 10.8k frames/s |
| Startup per session | 0.12 ms | 1.08 ms |

To be clear about what this means: it measures the **framework's overhead**,
not a conversation. What a caller hears is dominated by the round trips to the
speech-to-text, LLM and text-to-speech services, and those cost the same
whichever framework makes them. Where the difference matters is density: how
many calls one machine can hold, and what it costs to keep them open. The
[method](/docs/benchmarks/) is documented, and `make bench-compare` reproduces
it on your machine.

## What is in the box

- **Transports**: WebRTC (on [Pion](https://github.com/pion)), WebSocket,
  LiveKit, WhatsApp Business calls, local audio, and phone calls over Twilio,
  Telnyx, Plivo and Exotel.
- **50+ providers** for speech-to-text, LLMs and text-to-speech, including
  Deepgram, AssemblyAI, OpenAI, Anthropic, Gemini, ElevenLabs, Cartesia and Rime,
  plus local options (Moonshine, whisper.cpp, Ollama, Kokoro, Piper).
- **Speech-to-speech** models: OpenAI Realtime, Gemini Live, AWS Nova Sonic,
  xAI Realtime and Rime Prism.
- **Turn-taking and barge-in** with Silero VAD and Smart Turn v3, running
  locally.
- **RTVI** for clients, with web SDKs for JavaScript, React, Vue and web
  components in [jargo-web](https://github.com/gojargo/jargo-web).
- **Observability**: metrics, OpenTelemetry tracing and frame observers.

## What a bot looks like

A bot is a list of processors. This is the heart of a voice agent:

```go
stt := deepgram.NewSTT(deepgram.Config{APIKey: os.Getenv("DEEPGRAM_API_KEY")})
llm := chat.NewLLM(chat.LLMConfig{APIKey: os.Getenv("OPENAI_API_KEY")})
tts := cartesia.NewTTS(cartesia.Config{APIKey: os.Getenv("CARTESIA_API_KEY"), VoiceID: voice})

agg := aggregators.New(frames.NewLLMContext("You are a helpful voice assistant."),
	aggregators.WithVAD(aggregators.VADConfig{Analyzer: silero}))

p := pipeline.New(
	t.Input(),       // audio from the caller
	stt,             // speech to text
	agg.User(),      // the user's turn, into the context
	llm,             // the reply
	tts,             // text to speech
	t.Output(),      // audio back to the caller
	agg.Assistant(), // what the bot actually said, into the context
)
```

Swapping Deepgram for another speech-to-text provider changes one line. The
transport `t` is whichever one the session arrived on: the same bot answers a
browser over WebRTC and a phone call over Twilio.

## Try it

The echo bot needs no API keys and no native libraries:

```sh
git clone https://github.com/gojargo/jargo && cd jargo
go run ./examples/echo        # then open http://localhost:8080
```

From there, the [Quickstart](/docs/getting-started/quickstart/) runs a full
voice agent, and the getting-started examples build one up step by step.

## Status

jargo is pre-1.0: the API can still change in a minor release, and every
breaking change is called out in the changelog. It tracks Pipecat's releases,
so new Pipecat features are ported as they ship.

Issues, questions and pull requests are welcome on
[GitHub](https://github.com/gojargo/jargo), and
[Discussions](https://github.com/gojargo/jargo/discussions) is the place to ask
how to do something or to show what you built.
