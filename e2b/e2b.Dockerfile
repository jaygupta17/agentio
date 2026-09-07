# agentio E2B template — opencode v1.18.27 serve host
#
# What this is: a snapshot that boots fast and runs NOTHING agent-related at
# build time. `opencode serve` starts per-sandbox at runtime via boot.sh
# (each user injects their own keys then — never baked into the image).
#
# Build (legacy v1 build system, verified against e2b CLI source):
#   cd e2b && e2b template build -n agentio-opencode-v1
# New Template-SDK path also works: Template().fromDockerfile(<this file>).
# After build, record template ID in agentio-notes/decisions.md.
#
# Base carries python3/node so general-purpose agents have real tools.
# Digest pinned 2026-09-07 from Docker Hub (tag `latest`, last pushed
# 2026-07-23). Bump deliberately alongside OPENCODE_VERSION checks.

FROM e2bdev/code-interpreter@sha256:442ec598ec8ca4ed01b5bb24ad6e4f2e6ac80fd88f1564ff9a01e82da18e1e3b

ARG OPENCODE_VERSION=1.18.27

RUN curl -fsSL --retry 3 https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/opencode-linux-x64.tar.gz -o /tmp/opencode.tar.gz \
    && tar -xzf /tmp/opencode.tar.gz -C /usr/local/bin opencode \
    && chmod +x /usr/local/bin/opencode \
    && rm /tmp/opencode.tar.gz \
    && opencode --version

RUN mkdir -p /home/user/workspace /opt/agentio

COPY opencode.json /opt/agentio/opencode.json
COPY boot.sh /opt/agentio/boot.sh
RUN chmod +x /opt/agentio/boot.sh
