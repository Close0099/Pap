// Sistema de Exportação de Dados

class ExportSystem {
    // Exportar para CSV
    static exportToCSV(data, filename = 'relatorio.csv') {
        if (!data || data.length === 0) {
            alert('Nenhum dado para exportar.');
            return;
        }

        // Obter cabeçalhos
        const headers = Object.keys(data[0]);
        
        // Criar CSV
        let csv = headers.join(',') + '\n';
        
        data.forEach(row => {
            const values = headers.map(header => {
                let value = row[header];
                
                // Converter datas
                if (value instanceof Date) {
                    value = value.toLocaleDateString('pt-PT') + ' ' + value.toLocaleTimeString('pt-PT');
                }
                
                // Escape de aspas
                if (typeof value === 'string' && value.includes(',')) {
                    value = `"${value}"`;
                }
                
                return value || '';
            });
            
            csv += values.join(',') + '\n';
        });

        // Download
        this.downloadFile(csv, filename, 'text/csv');
    }

    // Exportar para JSON
    static exportToJSON(data, filename = 'relatorio.json') {
        if (!data || data.length === 0) {
            alert('Nenhum dado para exportar.');
            return;
        }

        const json = JSON.stringify(data, null, 2);
        this.downloadFile(json, filename, 'application/json');
    }

    // Exportar para PDF (usando html2pdf library)
    static async exportToPDF(htmlContent, filename = 'relatorio.pdf') {
        // Verificar se a biblioteca está disponível
        if (typeof html2pdf === 'undefined') {
            // Carregar biblioteca dinamicamente
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
            document.head.appendChild(script);
            
            script.onload = () => {
                this._generatePDF(htmlContent, filename);
            };
        } else {
            this._generatePDF(htmlContent, filename);
        }
    }

    static _generatePDF(content, filename) {
        const element = document.createElement('div');
        element.innerHTML = content;
        
        const opt = {
            margin: 10,
            filename: filename,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' }
        };

        html2pdf().set(opt).from(element).save();
    }

    // Helper: Download file
    static downloadFile(content, filename, type) {
        const blob = new Blob([content], { type: type });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    }

    // Exportar relatório de reservas com filtros
    static async exportReservationsReport(exportFormat = 'csv') {
        try {
            // Aqui seria buscado do Firebase
            console.log(`Gerando relatório em ${exportFormat}...`);
        } catch (error) {
            console.error('Erro ao exportar:', error);
            alert('Erro ao exportar dados.');
        }
    }
}

// Exportar como global
window.ExportSystem = ExportSystem;
