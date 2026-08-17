type t = int list

let radix = 1_000_000
let chunk_width = 6
let zero = []
let one = [ 1 ]

let normalize limbs =
  let rec drop_zeroes = function
    | 0 :: rest -> drop_zeroes rest
    | values -> values
  in
  List.rev (drop_zeroes (List.rev limbs))

let add left right =
  let rec loop carry left right digits =
    match (left, right) with
    | [], [] -> if carry = 0 then List.rev digits else List.rev (carry :: digits)
    | left_digit :: left_rest, [] | [], left_digit :: left_rest ->
        let sum = left_digit + carry in
        loop (sum / radix) left_rest [] ((sum mod radix) :: digits)
    | left_digit :: left_rest, right_digit :: right_rest ->
        let sum = left_digit + right_digit + carry in
        loop (sum / radix) left_rest right_rest ((sum mod radix) :: digits)
  in
  loop 0 left right []

let multiply_small value factor =
  let rec loop carry limbs digits =
    match limbs with
    | [] -> if carry = 0 then List.rev digits else List.rev (carry :: digits)
    | limb :: rest ->
        let product = (limb * factor) + carry in
        loop (product / radix) rest ((product mod radix) :: digits)
  in
  loop 0 value []

let decimal_digit = function
  | '0' .. '9' as digit -> Some (Char.code digit - Char.code '0')
  | _ -> None

let hexadecimal_digit = function
  | '0' .. '9' as digit -> Some (Char.code digit - Char.code '0')
  | 'a' .. 'f' as digit -> Some (Char.code digit - Char.code 'a' + 10)
  | 'A' .. 'F' as digit -> Some (Char.code digit - Char.code 'A' + 10)
  | _ -> None

let parse_decimal value =
  let length = String.length value in
  let rec validate index =
    if index = length then true
    else
      match decimal_digit value.[index] with
      | Some _ -> validate (index + 1)
      | None -> false
  in
  let rec collect finish chunks =
    if finish = 0 then Some (normalize (List.rev chunks))
    else
      let start = max 0 (finish - chunk_width) in
      let chunk = String.sub value start (finish - start) in
      match int_of_string_opt chunk with
      | Some limb -> collect start (limb :: chunks)
      | None -> None
  in
  if length = 0 || not (validate 0) then None else collect length []

let parse_hexadecimal value start =
  let length = String.length value in
  let rec collect index parsed =
    if index = length then Some (normalize parsed)
    else
      match hexadecimal_digit value.[index] with
      | Some digit ->
          collect (index + 1) (add (multiply_small parsed 16) [ digit ])
      | None -> None
  in
  if start = length then None else collect start zero

let of_string value =
  let length = String.length value in
  if length > 2 && value.[0] = '0' && (value.[1] = 'x' || value.[1] = 'X') then
    parse_hexadecimal value 2
  else parse_decimal value

let padded_chunk limb =
  let value = string_of_int limb in
  String.make (chunk_width - String.length value) '0' ^ value

let to_string value =
  match List.rev value with
  | [] -> "0"
  | most_significant :: rest ->
      String.concat ""
        (string_of_int most_significant :: List.map padded_chunk rest)

let compare left right =
  let left_length = List.length left in
  let right_length = List.length right in
  if left_length <> right_length then Stdlib.compare left_length right_length
  else
    let rec compare_digits left right =
      match (left, right) with
      | [], [] -> 0
      | left_digit :: left_rest, right_digit :: right_rest ->
          let comparison = Stdlib.compare left_digit right_digit in
          if comparison = 0 then compare_digits left_rest right_rest
          else comparison
      | [], _ :: _ -> -1
      | _ :: _, [] -> 1
    in
    compare_digits (List.rev left) (List.rev right)

let max left right = if compare left right >= 0 then left else right
