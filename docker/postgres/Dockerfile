FROM pgvector/pgvector:pg17

RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-server-dev-17 gcc make git ca-certificates \
    automake autoconf libtool \
    && git clone --depth 1 https://github.com/hightman/scws.git /tmp/scws \
    && cd /tmp/scws \
    && touch README && aclocal && autoconf && autoheader \
    && libtoolize && automake --add-missing \
    && ./configure && make install \
    && git clone --depth 1 https://github.com/amutu/zhparser.git /tmp/zhparser \
    && cd /tmp/zhparser && make && make install \
    && apt-get purge -y gcc make git postgresql-server-dev-17 automake autoconf libtool \
    && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* /tmp/scws /tmp/zhparser
