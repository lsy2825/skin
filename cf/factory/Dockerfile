# The price factory's box (가격 공장 상자): Python for the scrapers and the build, Node for the unit tests and wrangler, git to
# fetch the code from Cloudflare Artifacts and save the results back. The code itself is NOT baked in — entry.sh clones the
# latest main on every run, so a code change never needs a new image. Python packages come from the repo's pinned
# requirements.txt at run time for the same reason.
# Base images pinned by digest (python 3.12.15 full image — already has git, so no package downloads at build time;
# node 22.23.3; both built 2026-10-06). About 1.7 GB, within the "basic" instance's 4 GB disk.
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS node

FROM python:3.12-bookworm@sha256:5560e9ab8709f459489e5b8aa696eda8a07ef821e14bb122be62d91234bfa98b
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
# an optional build secret "ca" adds a company/proxy certificate for local test builds only
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi \
 && npm install -g --no-fund --no-audit wrangler@4.145.0 \
 && npm cache clean --force
# runs as an ordinary user, not root
RUN useradd --create-home --uid 10001 factory
USER factory
WORKDIR /home/factory
ENV PYTHONUTF8=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1 PIP_USER=1 WRANGLER=wrangler PATH=/home/factory/.local/bin:$PATH
COPY --chown=factory entry.sh /home/factory/entry.sh
ENTRYPOINT ["bash", "/home/factory/entry.sh"]
