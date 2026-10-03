from __future__ import annotations
import collections.abc
import datetime
import typing
from warnings import deprecated # type: ignore

import jpype # type: ignore
import jpype.protocol # type: ignore

import ghidra.framework
import java.io # type: ignore
import java.lang # type: ignore
import java.util # type: ignore
import java.util.concurrent # type: ignore


class Pty(java.lang.AutoCloseable):
    """
    A pseudo-terminal
     
     
    
    A pseudo-terminal is essentially a two way pipe where one end acts as the parent, and the other
    acts as the child. The process opening the pseudo-terminal is given a handle to both ends. The
    child end is generally given to a subprocess, possibly designating the pty as the controlling tty
    of a new session. This scheme is how, for example, an SSH daemon starts a new login shell. The
    shell is given the child end, and the parent end is presented to the SSH client.
     
     
    
    This is more powerful than controlling a process via standard in and standard out. 1) Some
    programs detect whether or not stdin/out/err refer to the controlling tty. For example, a program
    should avoid prompting for passwords unless stdin is the controlling tty. Using a pty can provide
    a controlling tty that is not necessarily controlled by a user. 2) Terminals have other
    properties and can, e.g., send signals to the foreground process group (job) by sending special
    characters. Normal characters are passed to the child, but special characters may be interpreted
    by the terminal's *line discipline*. A rather common case is to send Ctrl-C (character
    003). Using stdin, the subprocess simply reads 003. With a properly-configured pty and session,
    the subprocess is interrupted (sent SIGINT) instead.
     
     
    
    This class opens a pseudo-terminal and presents both ends as individual handles. The parent end
    simply provides an input and output stream. These are typical byte-oriented streams, except that
    the data passes through the pty, subject to interpretation by the OS kernel. On Linux, this means
    the pty will apply the configured line discipline. Consult the host OS documentation for special
    character sequences.
     
     
    
    The child end also provides the input and output streams, but it is uncommon to use them from the
    same process. More likely, subprocess is launched in a new session, configuring the child as the
    controlling terminal. Thus, the child handle provides methods for obtaining the child pty file
    name and/or spawning a new session. Once spawned, the parent end is used to control the session.
     
     
    
    Example:
     
     
    Pty pty = factory.openpty();
    pty.getChild().session("bash");
     
    PrintWriter writer = new PrintWriter(pty.getParent().getOutputStream());
    writer.println("echo test");
    BufferedReader reader =
        new BufferedReader(new InputStreamReader(pty.getParent().getInputStream()));
    System.out.println(reader.readLine());
    System.out.println(reader.readLine());
     
    pty.close();
    """

    class_: typing.ClassVar[java.lang.Class]

    def close(self) -> None:
        """
        Closes both ends of the pty
         
         
        
        This only closes this process's handles to the pty. For the parent end, this should be the
        only process with a handle. The child end may be opened by any number of other processes.
        More than likely, however, those processes will terminate once the parent end is closed,
        since reads or writes on the child will produce EOF or an error.
        
        :raises IOException: if an I/O error occurs
        """

    def getChild(self) -> PtyChild:
        """
        Get a handle to the child side of the pty
        
        :return: the child handle
        :rtype: PtyChild
        """

    def getParent(self) -> PtyParent:
        """
        Get a handle to the parent side of the pty
        
        :return: the parent handle
        :rtype: PtyParent
        """

    @property
    def parent(self) -> PtyParent:
        ...

    @property
    def child(self) -> PtyChild:
        ...


class PtyParent(PtyEndpoint):
    """
    The parent (UNIX "master") end of a pseudo-terminal
    """

    class_: typing.ClassVar[java.lang.Class]


class PtyEndpoint(java.lang.Object):
    """
    One end of a pseudo-terminal
    """

    class_: typing.ClassVar[java.lang.Class]

    def getInputStream(self) -> java.io.InputStream:
        """
        Get the input stream for this end of the pty
         
         
        
        Writes to the output stream of the opposite end arrive here, subject to the terminal's line
        discipline.
        
        :return: the input stream
        :rtype: java.io.InputStream
        :raises UnsupportedOperationException: if this end is not local
        """

    def getOutputStream(self) -> java.io.OutputStream:
        """
        Get the output stream for this end of the pty
         
         
        
        Writes to this stream arrive on the input stream for the opposite end, subject to the
        terminal's line discipline.
        
        :return: the output stream
        :rtype: java.io.OutputStream
        :raises UnsupportedOperationException: if this end is not local
        """

    @property
    def inputStream(self) -> java.io.InputStream:
        ...

    @property
    def outputStream(self) -> java.io.OutputStream:
        ...


class PtyChild(PtyEndpoint):
    """
    The child (UNIX "slave") end of a pseudo-terminal
    """

    class TermMode(java.lang.Object):
        """
        A terminal mode flag
        """

        class_: typing.ClassVar[java.lang.Class]


    class Echo(java.lang.Enum[PtyChild.Echo], PtyChild.TermMode):
        """
        Mode flag for local echo
        """

        class_: typing.ClassVar[java.lang.Class]
        ON: typing.Final[PtyChild.Echo]
        """
        Input is echoed to output by the terminal itself.
        """

        OFF: typing.Final[PtyChild.Echo]
        """
        No local echo.
        """


        @staticmethod
        def valueOf(name: typing.Union[java.lang.String, str]) -> PtyChild.Echo:
            ...

        @staticmethod
        def values() -> jpype.JArray[PtyChild.Echo]:
            ...


    class_: typing.ClassVar[java.lang.Class]

    @typing.overload
    def nullSession(self, mode: collections.abc.Sequence) -> str:
        """
        Start a session without a real leader, instead obtaining the pty's name
         
         
        
        This method or any other ``session`` method can only be invoked once per pty. It must be
        called before anyone reads the parent's output stream, since obtaining the filename may be
        implemented by the parent sending commands to its child.
         
         
        
        If the child end of the pty is on a remote system, this should be the file (or other
        resource) name as it would be accessed on that remote system.
        
        :param collections.abc.Sequence mode: the terminal mode. If a mode is not implemented, it may be silently ignored.
        :return: the file name
        :rtype: str
        :raises IOException: if the session could not be started or the pty name could not be
                    determined
        """

    @typing.overload
    def nullSession(self, *mode: PtyChild.TermMode) -> str:
        """
        
        
        :param jpype.JArray[PtyChild.TermMode] mode: the terminal mode. If a mode is not implemented, it may be silently ignored.
        :return: the file name
        :rtype: str
        :raises IOException: if the session could not be started or the pty name could not be
                    determined
        
        .. seealso::
        
            | :obj:`.nullSession(Collection)`
        """

    @typing.overload
    def session(self, args: jpype.JArray[java.lang.String], env: collections.abc.Mapping, workingDirectory: jpype.protocol.SupportsPath, mode: collections.abc.Sequence) -> PtySession:
        """
        Spawn a subprocess in a new session whose controlling tty is this pseudo-terminal
         
         
        
        This method or :meth:`nullSession(Collection) <.nullSession>` can only be invoked once per pty.
        
        :param jpype.JArray[java.lang.String] args: the image path and arguments
        :param collections.abc.Mapping env: the environment
        :param jpype.protocol.SupportsPath workingDirectory: the working directory
        :param collections.abc.Sequence mode: the terminal mode. If a mode is not implemented, it may be silently ignored.
        :return: a handle to the subprocess
        :rtype: PtySession
        :raises IOException: if the session could not be started
        """

    @typing.overload
    def session(self, args: jpype.JArray[java.lang.String], env: collections.abc.Mapping, workingDirectory: jpype.protocol.SupportsPath, *mode: PtyChild.TermMode) -> PtySession:
        """
        
        
        :param jpype.JArray[java.lang.String] args: the image path and arguments
        :param collections.abc.Mapping env: the environment
        :param jpype.protocol.SupportsPath workingDirectory: the working directory
        :param jpype.JArray[PtyChild.TermMode] mode: the terminal mode. If a mode is not implemented, it may be silently ignored.
        :return: a handle to the subprocess
        :rtype: PtySession
        :raises IOException: if the session could not be started
        
        .. seealso::
        
            | :obj:`.session(String[], Map, File, Collection)`
        """

    @typing.overload
    def session(self, args: jpype.JArray[java.lang.String], env: collections.abc.Mapping, *mode: PtyChild.TermMode) -> PtySession:
        """
        
        
        :param jpype.JArray[java.lang.String] args: the image path and arguments
        :param collections.abc.Mapping env: the environment
        :param jpype.JArray[PtyChild.TermMode] mode: the terminal mode. If a mode is not implemented, it may be silently ignored.
        :return: a handle to the subprocess
        :rtype: PtySession
        :raises IOException: if the session could not be started
        
        .. seealso::
        
            | :obj:`.session(String[], Map, File, Collection)`
        """

    def setWindowSize(self, cols: typing.Union[jpype.JShort, int], rows: typing.Union[jpype.JShort, int]) -> None:
        """
        Resize the terminal window to the given width and height, in characters
        
        :param jpype.JShort or int cols: the width in characters
        :param jpype.JShort or int rows: the height in characters
        """


class PtySession(java.lang.Object):
    """
    A session led by the child pty
     
     
    
    This is typically a handle to the (local or remote) process designated as the "session leader"
    """

    class_: typing.ClassVar[java.lang.Class]

    def description(self) -> str:
        """
        Get a human-readable description of the session
        
        :return: the description
        :rtype: str
        """

    def destroyForcibly(self) -> None:
        """
        Take the greatest efforts to terminate the session (leader and descendants)
         
         
        
        If this represents a remote session, this should strive to release the remote resources
        consumed by this session. If that is not possible, this should at the very least release
        whatever local resources are used in maintaining and controlling the remote session.
        """

    @typing.overload
    def waitExited(self) -> int:
        """
        Wait for the session leader to exit, returning its optional exit status code
        
        :return: the status code, if applicable and implemented
        :rtype: int
        :raises java.lang.InterruptedException: if the wait is interrupted
        """

    @typing.overload
    def waitExited(self, timeout: typing.Union[jpype.JLong, int], unit: java.util.concurrent.TimeUnit) -> int:
        ...


class PtyFactory(java.lang.Object):
    """
    A mechanism for opening pseudo-terminals
    """

    class_: typing.ClassVar[java.lang.Class]
    DEFAULT_COLS: typing.Final = 80
    DEFAULT_ROWS: typing.Final = 25

    def getDescription(self) -> str:
        """
        Get a human-readable description of the factory
        
        :return: the description
        :rtype: str
        """

    @staticmethod
    def local() -> PtyFactory:
        """
        Choose a factory of local pty's for the host operating system
        
        :return: the factory
        :rtype: PtyFactory
        """

    @typing.overload
    def openpty(self, cols: typing.Union[jpype.JShort, int], rows: typing.Union[jpype.JShort, int]) -> Pty:
        """
        Open a new pseudo-terminal
        
        :param jpype.JShort or int cols: the initial width in characters, or 0 to let the system decide both dimensions
        :param jpype.JShort or int rows: the initial height in characters, or 0 to let the system decide both dimensions
        :return: new new Pty
        :rtype: Pty
        :raises IOException: for an I/O error, including cancellation
        """

    @typing.overload
    def openpty(self) -> Pty:
        """
        Open a new pseudo-terminal of the default size (80 x
        25)
        
        :return: new new Pty
        :rtype: Pty
        :raises IOException: for an I/O error, including cancellation
        """

    @typing.overload
    def openpty(self, cols: typing.Union[jpype.JInt, int], rows: typing.Union[jpype.JInt, int]) -> Pty:
        """
        Open a new pseudo-terminal
        
        :param jpype.JInt or int cols: the initial width in characters, or 0 to let the system decide both dimensions
        :param jpype.JInt or int rows: the initial height in characters, or 0 to let the system decide both dimensions
        :return: new new Pty
        :rtype: Pty
        :raises IOException: for an I/O error, including cancellation
        """

    @property
    def description(self) -> java.lang.String:
        ...


class ShellUtils(java.lang.Object):

    @typing.type_check_only
    class State(java.lang.Enum[ShellUtils.State]):

        class_: typing.ClassVar[java.lang.Class]
        NORMAL: typing.Final[ShellUtils.State]
        NORMAL_ESCAPE: typing.Final[ShellUtils.State]
        DQUOTE: typing.Final[ShellUtils.State]
        DQUOTE_ESCAPE: typing.Final[ShellUtils.State]
        SQUOTE: typing.Final[ShellUtils.State]
        SQUOTE_ESCAPE: typing.Final[ShellUtils.State]

        @staticmethod
        def valueOf(name: typing.Union[java.lang.String, str]) -> ShellUtils.State:
            ...

        @staticmethod
        def values() -> jpype.JArray[ShellUtils.State]:
            ...


    class Shell(java.lang.Enum[ShellUtils.Shell]):
        """
        A target shell for command-line arguments
         
        
        This determines how arguments are quoted and/or escaped. This should be set based on the
        shell that is going to receive the actual commands, which may or may not be the local shell.
        In many cases, it is the local shell, but please ensure for remote cases, the correct shell
        is specified.
        """

        class_: typing.ClassVar[java.lang.Class]
        DISPLAY: typing.Final[ShellUtils.Shell]
        """
        For display purposes only. DO NOT pass to any actual shell.
        """

        UNIX_SH: typing.Final[ShellUtils.Shell]
        """
        Unix shells that follow the same conventions as "sh". This is most Unix shells.
        """

        WINDOWS: typing.Final[ShellUtils.Shell]
        """
        Plain Windows command-line arguments for the C runtime
        
        
        .. seealso::
        
            | `CommandLineToArgvWfunction <https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-commandlinetoargvw>`_
        """

        WINDOWS_CMD: typing.Final[ShellUtils.Shell]
        """
        The Windows cmd.exe shell.
         
        
        **NOTE:** It seems to me using this with :meth:`ShellUtils.generateLine(List, Shell) <ShellUtils.generateLine>`
        is futile, if the intent is to use specific argument numbers in the batch file, e.g.,
        ``%1``. If you make clear certain constraints to the user, maybe it's suitable,
        but especially involving quotes, it's not possible to encode any arbitrary string. It
        seems the cmd shell is primarily concerned with just passing the arguments along to child
        processes, as encoded, and then the child figures out the parsing. That said, if the
        child process parses to argc/argv, then so long as the *full* command line is
        passed through the batch file, it should work as intended. However, if grabbing
        individual arguments, they cannot be reliably controlled.
         
        
        LATER: There may be a way to factor the escaping part separately from the argument
        catenation part, so that special logic can be applied here to better guarantee argument
        numbering, but then there's still the issue if the final target is expected to parse to
        argc/argv, if that can be encoded reliably.
        """

        LOCAL: typing.Final[ShellUtils.Shell]
        """
        The local shell, probably
        """


        @staticmethod
        def forOs(os: ghidra.framework.OperatingSystem) -> ShellUtils.Shell:
            """
            Get the probable shell for the given operating system
            
            :param ghidra.framework.OperatingSystem os: the operating system
            :return: the shell, probably
            :rtype: ShellUtils.Shell
            """

        def generateArgument(self, a: typing.Union[java.lang.String, str]) -> str:
            """
            Escape and/or quote a single command-line argument
            
            :param java.lang.String or str a: the argument
            :return: the argument formed in such a way that the shell will interpret it as the given
                    string in one argument
            :rtype: str
            """

        @staticmethod
        def valueOf(name: typing.Union[java.lang.String, str]) -> ShellUtils.Shell:
            ...

        @staticmethod
        def values() -> jpype.JArray[ShellUtils.Shell]:
            ...


    class_: typing.ClassVar[java.lang.Class]

    def __init__(self) -> None:
        ...

    @staticmethod
    def generateEnvBlock(env: collections.abc.Mapping) -> str:
        ...

    @staticmethod
    def generateLine(args: java.util.List[java.lang.String], shell: ShellUtils.Shell) -> str:
        ...

    @staticmethod
    def parseArgs(args: typing.Union[java.lang.String, str]) -> java.util.List[java.lang.String]:
        """
        Parse a command line into an argument list
         
        
        LATER: This is meant to mimic UNIX- / C-style arguments, but that's probably not appropriate
        on all systems. We should either:
         
         
        1. Let the offer specify how @args ought to be treated.
        2. Let the header annotations for @args include some extra specifier.
        
        
        :param java.lang.String or str args: the arguments as a single string
        :return: the list of split arguments
        :rtype: java.util.List[java.lang.String]
        """

    @staticmethod
    @typing.overload
    def removePath(exec_: typing.Union[java.lang.String, str]) -> str:
        ...

    @staticmethod
    @typing.overload
    def removePath(args: java.util.List[java.lang.String]) -> java.util.List[java.lang.String]:
        ...



__all__ = ["Pty", "PtyParent", "PtyEndpoint", "PtyChild", "PtySession", "PtyFactory", "ShellUtils"]
