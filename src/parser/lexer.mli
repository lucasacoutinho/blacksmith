type state

val make_state : unit -> state
val lex_line : state -> string -> Types.token
