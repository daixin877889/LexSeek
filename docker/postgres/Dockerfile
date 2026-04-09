FROM pgvector/pgvector:pg17

RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-server-dev-17 gcc make git ca-certificates curl bzip2 \
    && curl -fsSL http://www.xunsearch.com/scws/down/scws-1.2.3.tar.bz2 -o /tmp/scws.tar.bz2 \
    && tar xjf /tmp/scws.tar.bz2 -C /tmp \
    && cd /tmp/scws-1.2.3 \
    && ./configure && make install \
    && git clone --depth 1 https://github.com/amutu/zhparser.git /tmp/zhparser \
    && cd /tmp/zhparser && make && make install \
    && apt-get purge -y gcc make git postgresql-server-dev-17 curl bzip2 \
    && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* /tmp/scws* /tmp/zhparser
