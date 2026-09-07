# agentio E2B template — opencode v1.18.27 serve host
#
# What this is: a snapshot that boots fast and runs NOTHING agent-related at
# build time. `opencode serve` starts per-sandbox at runtime via boot.sh
# (each user injects their own keys then — never baked into the image).
#
# Build (legacy v1 build system, verified against e2b CLI source):
#   cd app/template && e2b template build -n agentio-opencode-v1
# New Template-SDK path also works: Template().fromDockerfile(<this file>).
# After build, record template ID + base-image digest in ../../decisions.md.
#
# Base carries python3/node so general-purpose agents have real tools.
# Tradeoff: heavier than bare ubuntu, and `latest` floats — pin the digest
# after the first good build (docker inspect) and lock it here.

FROM e2bdev/code-interpreter:latest

ARG OPENCODE_VERSION=1.18.27

RUN curl -fsSL https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/opencode-linux-x64.tar.gz -o /tmp/opencode.tar.gz \
    && tar -xzf /tmp/opencode.tar.gz -C /usr/local/bin opencode \
    && chmod +x /usr/local/bin/opencode \
    && rm /tmp/opencode.tar.gz \
    && opencode --version

RUN mkdir -p /home/user/workspace /opt/agentio

COPY opencode.json /opt/agentio/opencode.json
COPY boot.sh /opt/agentio/boot.sh
RUN chmod +x /opt/agentio/boot.sh
