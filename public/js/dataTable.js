$(document).ready(function() {
    $('#ticketTable').DataTable({
        paging: true,
        searching: true,
        ordering: true,
        lengthChange: true,
        pageLength: 10,
        dom: 'Bfrtip',
        buttons: [
            'copy', 'excel', 'pdf', 'print'
        ],
        "language": {
            "lengthMenu": "Tampilkan _MENU_ entri",
            "zeroRecords": "Tidak ada data yang ditemukan",
            "info": "Menampilkan halaman _PAGE_ dari _PAGES_",
            "infoEmpty": "Tidak ada entri tersedia",
            "infoFiltered": "(disaring dari _MAX_ total entri)",
            "search": "Cari:",
            "paginate": {
                "first": "Pertama",
                "last": "Terakhir",
                "next": "Selanjutnya",
                "previous": "Sebelumnya"
            }
        }
    });
}); 