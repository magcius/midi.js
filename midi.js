(function(exports) {

    function makeStream(buffer) {
        var stream = new DataView(buffer);
        stream.length = buffer.byteLength;
        stream.pos = 0;
        return stream;
    }

    function eof(stream) {
        return stream.pos >= stream.length;
    }

    function readByte(stream) {
        return stream.getUint8(stream.pos++);
    }

    function readWord(stream) {
        return stream.getUint16((stream.pos += 2) - 2, true);
    }

    function readLong(stream) {
        return stream.getUint32((stream.pos += 4) - 4, true);
    }

    function collect(stream, f, length) {
        var B = [];
        for (var i = 0; i < length; i++)
            B.push(f(stream));
        return B;
    }

    function readString(stream, length) {
        var B = collect(stream, readByte, length);
        return B.map(function(c) {
            return String.fromCharCode(c);
        }).join('');
    }

    function invalid() {
        throw new Error("invalid");
    }

    function parseChunkHeader(stream) {
        var type = readString(stream, 4);
        var size = readLong(stream);
        var offs = stream.pos;
        return { type: type, size: size, offs: offs };
    }

    /*
    function parseDLS(stream) {
        var header = parseChunkHeader(stream);
        if (header.type != "RIFF")
            invalid();
        var readFormType = readString(stream, 4);
        if (readFormType != "DLS ")
            invalid();

        while (!eof(stream)) {
            var h = parseChunkHeader(stream);
            stream.pos += h.size;
        }
    }
    */

    var parseDLS = (function() {
        function Serial(children) {
            return function(stream, parentHeader) {
                return children.map(function(childParse) {
                    return childParse(stream, parentHeader);
                });
            };
        }

        function Optional(childParse) {
            return function(stream, parentHeader) {
                var oldPos = stream.pos;

                try {
                    return childParse(stream, parentHeader);
                } catch(e) {
                    // invalid, move on
                    stream.pos = oldPos;
                    return null;
                }
            }
        }

        function Repeat(childParse) {
            return function(stream, parentHeader) {
                var children = [];
                var end = stream.pos + parentHeader.size;
                while (stream.pos < end) {
                    children.push(childParse(stream, parentHeader));
                }
                return children;
            };
        }

        function Chunk(chunkId) {
            return function(stream, parentHeader) {
                if (stream.pos > parentHeader.offs + parentHeader.size)
                    invalid();

                var header = parseChunkHeader(stream);
                if (header.type != chunkId)
                    invalid();

                var offs = stream.pos;
                stream.pos += header.size;
                return { type: chunkId, offs: offs, size: header.size };
            };
        }

        function List(childType, childParse) {
            return function(stream, parentHeader) {
                var header = parseChunkHeader(stream);
                if (header.type != "LIST")
                    invalid();

                var readChildType = readString(stream, 4);
                if (readChildType != childType)
                    invalid();
                header.size -= 4;

                if (childParse) {
                    return childParse(stream, header);
                } else {
                    var offs = stream.pos;
                    stream.pos += header.size;
                    return { type: childType, offs: offs, size: header.size };
                }
            };
        }

        function RIFF(formType, childParse) {
            return function(stream, parentHeader) {
                var header = parseChunkHeader(stream);
                if (header.type != "RIFF")
                    invalid();

                var readFormType = readString(stream, 4);
                if (readFormType != formType)
                    invalid();
                header.size -= 4;

                return childParse(stream, header);
            };
        }

        return RIFF('DLS ', Serial([
            Chunk("colh"),
            Chunk("vers"),
            Chunk("msyn"),
            List("lins", Repeat(List("ins ", Serial([
                Chunk("insh"),
                List("lrgn", Repeat(List("rgn ", Serial([
                    Chunk("rgnh"),
                    Chunk("wsmp"),
                    Chunk("wlnk"),
                    Optional(List("lart", Repeat(Chunk("art1")))),
                ])))),
                Optional(List("lart", Repeat(Chunk("art1")))),
                Optional(List("INFO", null)),
            ])))),
            Chunk("ptbl"),
            List("wvpl", Repeat(List("wave", null))),
        ]));
    })();

    function makeWaveTable(dls, stream) {
        var wvpl = dls[5];

        var ctx = new AudioContext();
        var table = new Array(wvpl.length);

        function playBuffer(buffer) {
            var src = ctx.createBufferSource();
            src.buffer = buffer;
            src.connect(ctx.destination);
            src.start(0);
        }

        wvpl.forEach(function(wave, i) {
            // wave.offs points to the "fmt " chunk
            var waveOffs = wave.offs - 12;
            var waveSize = wave.size + 12;

            function writeString(offs, str) {
                [].forEach.call(str, function(c) {
                    stream.setUint8(offs++, c.charCodeAt(0));
                });
            }

            // rewrite "LIST" to "RIFF"
            writeString(waveOffs, 'RIFF');
            // rewrite "wave" to "WAVE"
            writeString(waveOffs + 0x08, 'WAVE');

            // Firefox doesn't like the extra data in the FMT chunk,
            // so get rid of it.
            stream.setUint8(waveOffs + 0x24, 0);

            var waveData = stream.buffer.slice(waveOffs, waveOffs + waveSize);
            ctx.decodeAudioData(waveData, function(buffer) {
                table[i] = buffer;
                if (i == 289) // PIANO36
                    playBuffer(buffer);
            },
            function() {
                console.error("decode error");
            });
        });
    }

    function fetch(path) {
        var request = new XMLHttpRequest();
        request.open("GET", path, true);
        request.responseType = "arraybuffer";
        request.send();
        return request;
    }

    window.onload = function() {
        var req = fetch("gm.dls");
        req.onload = function() {
            var stream = makeStream(req.response);
            var dls = parseDLS(stream);
            makeWaveTable(dls, stream);
        };
    };

    exports.SPC = {};

})(window);
