// Parses Il2CppDumper's il2cpp_ghidra.h into the current program's data type manager.
// Headless usage: -preScript ParseIl2cppHeader.java <path-to-il2cpp_ghidra.h>
// @category Il2Cpp

import java.io.FileInputStream;
import java.io.InputStream;

import ghidra.app.script.GhidraScript;
import ghidra.app.util.cparser.C.CParser;
import ghidra.program.model.data.DataTypeManager;

public class ParseIl2cppHeader extends GhidraScript {

    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        String path = args.length > 0 ? args[0] : askFile("il2cpp_ghidra.h", "Parse").getAbsolutePath();
        DataTypeManager dtm = currentProgram.getDataTypeManager();
        int before = dtm.getDataTypeCount(true);
        long t0 = System.currentTimeMillis();
        println("Parsing " + path + " ...");
        CParser parser = new CParser(dtm, true, null);
        try (InputStream in = new FileInputStream(path)) {
            parser.parse(in);
        }
        String msgs = parser.getParseMessages();
        if (msgs != null && !msgs.isEmpty()) {
            println("Parser messages (first 2000 chars): " + msgs.substring(0, Math.min(2000, msgs.length())));
        }
        println("Header parsed: " + (dtm.getDataTypeCount(true) - before) + " data types added in "
            + ((System.currentTimeMillis() - t0) / 1000) + " s");
    }
}
