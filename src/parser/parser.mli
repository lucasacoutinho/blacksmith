type state

val make_state : unit -> state
val interpret : state -> Types.token -> unit
val function_count : state -> int
val current_function : state -> string
val finish : state -> Types.profile_data
