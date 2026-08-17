type t

val zero : t
val one : t
val of_string : string -> t option
val to_string : t -> string
val compare : t -> t -> int
val add : t -> t -> t
val max : t -> t -> t
